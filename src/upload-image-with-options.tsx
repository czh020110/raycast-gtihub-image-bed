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
} from "@raycast/api";
import { useState, useEffect } from "react";
import * as fs from "fs";
import dayjs from "dayjs";
import * as fileType from "file-type";
import { Octokit } from "@octokit/core";
import { RequestError } from "@octokit/request-error";
import { saveClipboardImageToFile } from "./utils";
import * as os from "os";
import * as path from "path";

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

interface UploadResult {
  status: "loading" | "success" | "error";
  url: string;
  errorMessage: string;
}

/**
 * Get image from clipboard
 */
async function getImageFromClipboard(): Promise<{
  buffer: Buffer;
  ext: string;
} | null> {
  const data = await Clipboard.read();

  if (data.file) {
    const filepath = decodeURIComponent(data.file.replace(/^file:\/\//, ""));
    try {
      const buffer = fs.readFileSync(filepath);
      // Convert Buffer to Uint8Array for file-type API
      const uint8Array = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
      const type = await fileType.fileTypeFromBuffer(uint8Array);

      if (type && type.mime.startsWith("image")) {
        return { buffer, ext: type.ext };
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  }

  // Fallback: Try to read image data directly using AppleScript (for screenshots)
  try {
    const tempFile = path.join(os.tmpdir(), `raycast-upload-${Date.now()}.png`);
    await saveClipboardImageToFile(tempFile);

    if (fs.existsSync(tempFile)) {
      const buffer = fs.readFileSync(tempFile);
      // Clean up temp file
      fs.unlinkSync(tempFile);

      return { buffer, ext: "png" };
    }
  } catch (error) {
    // Ignore error if no image in clipboard
    console.error("Failed to read clipboard image:", error);
  }

  return null;
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
function normalizePath(path: string): string {
  if (!path) return "";
  let normalized = path;
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
 * Upload image to GitHub
 */
async function uploadImage(preferences: Preferences): Promise<string> {
  const image = await getImageFromClipboard();

  if (!image) {
    throw new Error("No image found in clipboard");
  }

  const content = image.buffer.toString("base64");
  const path = normalizePath(preferences.path);
  const filename = generateFilename(image.ext);
  const filePath = `${path}${filename}`;

  const octokit = new Octokit({ auth: preferences.githubToken });

  try {
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
  } catch (error) {
    // If error is 409 Conflict (SHA mismatch), the file might already exist
    // This can happen with rapid consecutive uploads
    if (error instanceof RequestError && error.status === 409) {
      throw new Error("Upload conflict: Please wait a moment and try again.");
    } else {
      throw error;
    }
  }

  return buildCdnUrl(
    preferences.cdnUrl,
    preferences.owner,
    preferences.repo,
    preferences.branch || "main",
    filePath,
  );
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [result, setResult] = useState<UploadResult>({
    status: "loading",
    url: "",
    errorMessage: "",
  });

  useEffect(() => {
    uploadImage(preferences)
      .then((url) => {
        setResult({
          status: "success",
          url,
          errorMessage: "",
        });
        showToast({
          style: Toast.Style.Success,
          title: "Image uploaded successfully!",
        });
      })
      .catch((error) => {
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
      });
  }, []);

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
