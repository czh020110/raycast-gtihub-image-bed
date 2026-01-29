import {
  showToast,
  Toast,
  Clipboard,
  getPreferenceValues,
  showHUD,
  LaunchProps,
} from "@raycast/api";
import * as fs from "fs";
import * as fileType from "file-type";
import { Octokit } from "@octokit/core";
import { RequestError } from "@octokit/request-error";
import {
  saveClipboardImageToFile,
  generateFilenameFromTemplate,
} from "./utils";
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
  filenameTemplate: string;
}

interface Arguments {
  imageName?: string;
}

/**
 * Get image from clipboard
 * Supports both copied files (from Finder) and screenshot images
 */
async function getImageFromClipboard(): Promise<{
  buffer: Buffer;
  ext: string;
} | null> {
  const data = await Clipboard.read();

  if (data.file) {
    // Handle file copied from Finder
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
 * Format URL based on selected format
 */
function formatUrl(url: string, format: "markdown" | "url" | "html"): string {
  switch (format) {
    case "markdown":
      return `![](${url})`;
    case "html":
      return `<img src="${url}" alt="" />`;
    case "url":
    default:
      return url;
  }
}

/**
 * Upload image to GitHub
 */
async function uploadImage(
  preferences: Preferences,
  imageName: string = "",
): Promise<string> {
  const image = await getImageFromClipboard();

  if (!image) {
    throw new Error("No image found in clipboard. Please copy an image first.");
  }

  const content = image.buffer.toString("base64");
  const path = normalizePath(preferences.path);
  const filename = generateFilenameFromTemplate(
    preferences.filenameTemplate,
    image.ext,
    imageName,
  );
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

  // Generate CDN URL
  const cdnUrl = buildCdnUrl(
    preferences.cdnUrl,
    preferences.owner,
    preferences.repo,
    preferences.branch || "main",
    filePath,
  );

  return cdnUrl;
}

/**
 * Main command: Quick upload without UI
 */
export default async function Command(
  props: LaunchProps<{ arguments: Arguments }>,
) {
  const preferences = getPreferenceValues<Preferences>();
  const { imageName } = props.arguments;

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Uploading image...",
  });

  try {
    const url = await uploadImage(preferences, imageName || "");
    const formattedUrl = formatUrl(url, preferences.defaultFormat);

    await Clipboard.copy(formattedUrl);

    toast.style = Toast.Style.Success;
    toast.title = "Image uploaded!";
    toast.message = "URL copied to clipboard";

    await showHUD("✅ Image uploaded! URL copied to clipboard");
  } catch (error) {
    toast.style = Toast.Style.Failure;

    if (error instanceof RequestError) {
      toast.title = "GitHub API Error";
      toast.message = error.message;
    } else if (error instanceof Error) {
      toast.title = "Upload Failed";
      toast.message = error.message;
    } else {
      toast.title = "Upload Failed";
      toast.message = "Unknown error occurred";
    }
  }
}
