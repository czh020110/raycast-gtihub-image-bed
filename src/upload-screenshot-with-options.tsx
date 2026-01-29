// @ts-nocheck
import {
  List,
  ActionPanel,
  Action,
  getPreferenceValues,
  Icon,
  showToast,
  Toast,
  Clipboard,
  closeMainWindow,
  open,
  environment,
  LaunchProps,
} from "@raycast/api";
import { useState, useEffect } from "react";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Octokit } from "@octokit/core";
import { RequestError } from "@octokit/request-error";
import { exec } from "child_process";
import { promisify } from "util";
import { generateFilenameFromTemplate } from "./utils";

const execAsync = promisify(exec);

interface Preferences {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  email: string;
  cdnUrl: string;
  defaultFormat: "markdown" | "url" | "html";
  filenameTemplate: string;
}

interface Arguments {
  imageName?: string;
}

interface LaunchContext {
  screenshotPath?: string;
  cancelled?: boolean;
  imageName?: string;
}

interface UploadResult {
  status: "loading" | "success" | "error" | "waiting";
  url: string;
  errorMessage: string;
}

/**
 * Format path to ensure it ends with /
 */
function normalizePath(p: string): string {
  if (!p) return "";
  let normalized = p;
  if (normalized.startsWith("/")) {
    normalized = normalized.substring(1);
  }
  if (normalized && !normalized.endsWith("/")) {
    normalized += "/";
  }
  return normalized;
}

/**
 * Build CDN URL from template
 */
function buildCdnUrl(
  template: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): string {
  return template
    .replace("{owner}", owner)
    .replace("{repo}", repo)
    .replace("{branch}", branch)
    .replace("{path}", filePath);
}

/**
 * Upload image buffer to GitHub
 */
async function uploadImageBuffer(
  buffer: Buffer,
  preferences: Preferences,
  imageName: string = "",
): Promise<string> {
  const content = buffer.toString("base64");
  const p = normalizePath(preferences.path);
  const filename = generateFilenameFromTemplate(
    preferences.filenameTemplate,
    "png",
    imageName,
  );
  const filePath = `${p}${filename}`;

  const octokit = new Octokit({ auth: preferences.githubToken });

  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner: preferences.owner,
    repo: preferences.repo,
    path: filePath,
    message: `Upload screenshot: ${filename}`,
    committer: {
      name: preferences.owner,
      email: preferences.email,
    },
    content: content,
    branch: preferences.branch || "main",
  });

  return buildCdnUrl(
    preferences.cdnUrl,
    preferences.owner,
    preferences.repo,
    preferences.branch || "main",
    filePath,
  );
}

/**
 * Trigger system screenshot and callback via Deep Link
 */
async function triggerScreenshotAndCallback(
  imageName: string = "",
): Promise<void> {
  const timestamp = Date.now();
  const filePath = path.join(os.tmpdir(), `screenshot-${timestamp}.png`);
  const filePathEscaped = filePath.replace(/\\/g, "\\\\");

  // 1. Hide Raycast window
  await closeMainWindow({ clearRootSearch: true });
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 2. Clear clipboard
  try {
    await execAsync(
      `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()"`,
    );
  } catch {}

  // 3. Launch screenshot tool
  try {
    await execAsync(`explorer.exe ms-screenclip:`);
  } catch {
    try {
      await execAsync(`powershell -Command "Start-Process 'ms-screenclip:'"`);
    } catch {
      const context = JSON.stringify({ cancelled: true });
      const encodedContext = encodeURIComponent(context);
      await open(
        `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-screenshot-with-options?launchContext=${encodedContext}`,
      );
      return;
    }
  }

  // 4. Poll for clipboard image
  let attempts = 0;
  const maxAttempts = 120;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;

    try {
      const scriptPath = path.join(
        os.tmpdir(),
        `check-clipboard-${timestamp}.ps1`,
      );
      const checkAndSaveScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $img.Save('${filePathEscaped}', [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output 'SAVED'
} else {
    Write-Output 'EMPTY'
}
`;
      fs.writeFileSync(scriptPath, checkAndSaveScript, "utf-8");
      const { stdout } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`,
      );
      try {
        fs.unlinkSync(scriptPath);
      } catch {}

      if (stdout.trim().includes("SAVED") && fs.existsSync(filePath)) {
        // Screenshot successful, callback via Deep Link
        const context = JSON.stringify({ screenshotPath: filePath, imageName });
        const encodedContext = encodeURIComponent(context);
        await open(
          `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-screenshot-with-options?launchContext=${encodedContext}`,
        );
        return;
      }
    } catch {
      // Continue waiting
    }
  }

  // Timeout, notify cancelled
  const context = JSON.stringify({ cancelled: true });
  const encodedContext = encodeURIComponent(context);
  await open(
    `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-screenshot-with-options?launchContext=${encodedContext}`,
  );
}

export default function Command(
  props: LaunchProps<{ arguments: Arguments; launchContext?: LaunchContext }>,
) {
  const preferences = getPreferenceValues<Preferences>();
  const { launchContext } = props;
  const imageName =
    launchContext?.imageName || props.arguments?.imageName || "";

  const [result, setResult] = useState<UploadResult>({
    status: "waiting",
    url: "",
    errorMessage: "",
  });

  // Prevent duplicate uploads
  const hasProcessed = useState({ current: false })[0];

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    if (!launchContext) {
      // Initial launch: trigger screenshot
      triggerScreenshotAndCallback(imageName);
      return;
    }

    if (launchContext.cancelled) {
      setResult({
        status: "error",
        url: "",
        errorMessage: "Screenshot cancelled",
      });
      return;
    }

    if (launchContext.screenshotPath) {
      setResult({
        status: "loading",
        url: "",
        errorMessage: "",
      });

      (async () => {
        try {
          if (!fs.existsSync(launchContext.screenshotPath)) {
            throw new Error("Screenshot file not found");
          }

          const buffer = fs.readFileSync(launchContext.screenshotPath);

          // Clean up temp file
          try {
            fs.unlinkSync(launchContext.screenshotPath);
          } catch {}

          const url = await uploadImageBuffer(buffer, preferences, imageName);

          setResult({
            status: "success",
            url,
            errorMessage: "",
          });

          showToast({
            style: Toast.Style.Success,
            title: "Screenshot uploaded successfully!",
          });
        } catch (error) {
          let errorMessage = "Unknown error occurred";
          if (error instanceof RequestError) {
            errorMessage = `GitHub API Error: ${error.message}`;
          } else if (error instanceof Error) {
            errorMessage = error.message;
          }
          setResult({
            status: "error",
            url: "",
            errorMessage,
          });
          showToast({
            style: Toast.Style.Failure,
            title: "Upload failed",
            message: errorMessage,
          });
        }
      })();
    }
  }, []);

  if (result.status === "waiting") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Camera}
          title="Taking Screenshot..."
          description="Please capture your screen"
        />
      </List>
    );
  }

  if (result.status === "loading") {
    return <List isLoading={true} />;
  }

  if (result.status === "error") {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Upload Failed"
          description={result.errorMessage}
        />
      </List>
    );
  }

  const markdownUrl = `![](${result.url})`;
  const htmlUrl = `<img src="${result.url}" alt="" />`;

  return (
    <List>
      <List.Section title="Choose format to copy">
        <List.Item
          icon={Icon.Document}
          title="Markdown"
          subtitle={markdownUrl}
          accessories={[{ text: "![](url)" }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Markdown"
                content={markdownUrl}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Link}
          title="Direct URL"
          subtitle={result.url}
          accessories={[{ text: "https://..." }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy URL" content={result.url} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Code}
          title="HTML"
          subtitle={htmlUrl}
          accessories={[{ text: "<img>" }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy HTML" content={htmlUrl} />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Actions">
        <List.Item
          icon={Icon.Globe}
          title="Open in Browser"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={result.url} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  ) as any;
}
