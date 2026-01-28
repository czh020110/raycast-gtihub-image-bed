/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** GitHub Token - Your GitHub Personal Access Token with repo scope. */
  "githubToken": string,
  /** Repository Owner - Owner of the GitHub repository (username or organization). */
  "owner": string,
  /** Repository Name - Name of the GitHub repository. */
  "repo": string,
  /** Branch - Branch to upload images to. */
  "branch": string,
  /** Upload Path - Folder path within the repository to store images. */
  "path": string,
  /** Committer Email - Email address for commit messages. */
  "email": string,
  /** CDN URL Template - CDN URL template. Use {owner}, {repo}, {branch}, {path} as placeholders. */
  "cdnUrl": string,
  /** Default Output Format - Default format for copied URL. */
  "defaultFormat": "markdown" | "url" | "html"
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `upload-from-clipboard` command */
  export type UploadFromClipboard = ExtensionPreferences & {}
  /** Preferences accessible in the `upload-from-clipboard-with-options` command */
  export type UploadFromClipboardWithOptions = ExtensionPreferences & {}
  /** Preferences accessible in the `upload-screenshot` command */
  export type UploadScreenshot = ExtensionPreferences & {}
  /** Preferences accessible in the `upload-screenshot-with-options` command */
  export type UploadScreenshotWithOptions = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `upload-from-clipboard` command */
  export type UploadFromClipboard = {}
  /** Arguments passed to the `upload-from-clipboard-with-options` command */
  export type UploadFromClipboardWithOptions = {}
  /** Arguments passed to the `upload-screenshot` command */
  export type UploadScreenshot = {}
  /** Arguments passed to the `upload-screenshot-with-options` command */
  export type UploadScreenshotWithOptions = {}
}

