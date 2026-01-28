// @ts-nocheck
import {
  List,
  ActionPanel,
  Action,
  getPreferenceValues,
  Icon,
  showToast,
  Toast,
  closeMainWindow,
  open,
  environment,
  LaunchProps,
} from "@raycast/api";
import { useState, useEffect } from "react";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import dayjs from "dayjs";
import * as fileType from "file-type";
import { Octokit } from "@octokit/core";
import { RequestError } from "@octokit/request-error";
import { exec } from "child_process";
import { promisify } from "util";

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
}

interface LaunchContext {
  filePath?: string;
  cancelled?: boolean;
}

interface UploadResult {
  status: "loading" | "success" | "error" | "waiting";
  url: string;
  errorMessage: string;
}

/**
 * Generate unique filename with timestamp
 */
function generateFilename(ext: string): string {
  const timestamp = dayjs().format("YYYY-MM-DD_HHmmss");
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}.${ext}`;
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
  ext: string,
  preferences: Preferences,
): Promise<string> {
  const content = buffer.toString("base64");
  const p = normalizePath(preferences.path);
  const filename = generateFilename(ext);
  const filePath = `${p}${filename}`;

  const octokit = new Octokit({ auth: preferences.githubToken });

  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner: preferences.owner,
    repo: preferences.repo,
    path: filePath,
    message: `Upload image: ${filename}`,
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
 * Open file picker dialog and callback via Deep Link
 */
async function openFilePickerAndCallback(): Promise<void> {
  // Hide Raycast window
  await closeMainWindow({ clearRootSearch: true });
  await new Promise((resolve) => setTimeout(resolve, 300));

  // PowerShell script to open file picker
  const scriptPath = path.join(os.tmpdir(), `file-picker-${Date.now()}.ps1`);
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "Image files (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All files (*.*)|*.*"
$dialog.Title = "Select an image to upload"
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
} else {
    Write-Output "CANCELLED"
}
`;

  try {
    fs.writeFileSync(scriptPath, psScript, "utf-8");
    const { stdout } = await execAsync(
      `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`,
    );
    try {
      fs.unlinkSync(scriptPath);
    } catch {}

    const selectedPath = stdout.trim();

    if (selectedPath === "CANCELLED" || !selectedPath) {
      const context = JSON.stringify({ cancelled: true });
      const encodedContext = encodeURIComponent(context);
      await open(
        `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-from-file?launchContext=${encodedContext}`,
      );
      return;
    }

    // File selected, callback via Deep Link
    const context = JSON.stringify({ filePath: selectedPath });
    const encodedContext = encodeURIComponent(context);
    await open(
      `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-from-file?launchContext=${encodedContext}`,
    );
  } catch (error) {
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
    const context = JSON.stringify({ cancelled: true });
    const encodedContext = encodeURIComponent(context);
    await open(
      `raycast://extensions/${environment.ownerOrAuthorName}/${environment.extensionName}/upload-from-file?launchContext=${encodedContext}`,
    );
  }
}

export default function Command(
  props: LaunchProps<{ launchContext?: LaunchContext }>,
) {
  const preferences = getPreferenceValues<Preferences>();
  const { launchContext } = props;

  const [result, setResult] = useState<UploadResult>({
    status: "waiting",
    url: "",
    errorMessage: "",
  });

  // Prevent duplicate processing
  const hasProcessed = useState({ current: false })[0];

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    if (!launchContext) {
      // Initial launch: open file picker
      openFilePickerAndCallback();
      return;
    }

    if (launchContext.cancelled) {
      setResult({
        status: "error",
        url: "",
        errorMessage: "File selection cancelled",
      });
      return;
    }

    if (launchContext.filePath) {
      setResult({
        status: "loading",
        url: "",
        errorMessage: "",
      });

      (async () => {
        try {
          if (!fs.existsSync(launchContext.filePath)) {
            throw new Error("Selected file not found");
          }

          const buffer = fs.readFileSync(launchContext.filePath);

          // Detect file type
          const uint8Array = new Uint8Array(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength,
          );
          const type = await fileType.fileTypeFromBuffer(uint8Array);

          if (!type || !type.mime.startsWith("image")) {
            throw new Error("Selected file is not a valid image");
          }

          const url = await uploadImageBuffer(buffer, type.ext, preferences);

          setResult({
            status: "success",
            url,
            errorMessage: "",
          });

          showToast({
            style: Toast.Style.Success,
            title: "Image uploaded successfully!",
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
          icon={Icon.Finder}
          title="Select File..."
          description="Please choose an image file to upload"
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
