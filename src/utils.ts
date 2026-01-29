import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import dayjs from "dayjs";

/**
 * Generate filename from template with placeholder replacement
 * Placeholders: {yyyy}, {yy}, {MM}, {dd}, {hh}, {mm}, {ss}, {sss}, {name}
 */
export function generateFilenameFromTemplate(
  template: string,
  ext: string,
  name: string = "",
): string {
  const now = dayjs();
  const random = Math.random().toString(36).substring(2, 8);

  // If template is empty or undefined, use default format
  if (!template || !template.trim()) {
    const timestamp = now.format("YYYY-MM-DD_HHmmss");
    return name
      ? `${timestamp}_${name}.${ext}`
      : `${timestamp}_${random}.${ext}`;
  }

  let filename = template
    .replace(/{yyyy}/g, now.format("YYYY"))
    .replace(/{yy}/g, now.format("YY"))
    .replace(/{MM}/g, now.format("MM"))
    .replace(/{dd}/g, now.format("DD"))
    .replace(/{hh}/g, now.format("HH"))
    .replace(/{mm}/g, now.format("mm"))
    .replace(/{ss}/g, now.format("ss"))
    .replace(/{sss}/g, now.format("SSS"))
    .replace(/{name}/g, name || "")
    .replace(/{random}/g, random);

  // Clean up: remove trailing/leading underscores/hyphens and consecutive separators
  filename = filename
    .replace(/[-_]+$/, "")
    .replace(/^[-_]+/, "")
    .replace(/[-_]{2,}/g, "_");

  // If filename is empty after processing, use default
  if (!filename.trim()) {
    filename = `${now.format("YYYY-MM-DD_HHmmss")}_${random}`;
  }

  return `${filename}.${ext}`;
}

/**
 * Saves the clipboard image to a temporary file.
 * Cross-platform support: Windows (PowerShell) and macOS (AppleScript)
 */
export async function saveClipboardImageToFile(
  filepath: string,
): Promise<void> {
  const platform = os.platform();

  if (platform === "win32") {
    // Windows: Use PowerShell to save clipboard image
    // Write script to temp file to avoid escaping issues
    const scriptPath = path.join(
      os.tmpdir(),
      `raycast-clipboard-${Date.now()}.ps1`,
    );
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$clipboard = [System.Windows.Forms.Clipboard]::GetImage()
if ($clipboard -ne $null) {
    $clipboard.Save('${filepath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "ok"
} else {
    Write-Output "error"
}
`;

    try {
      // Write script to temp file
      fs.writeFileSync(scriptPath, psScript, "utf-8");

      // Execute the script file
      const result = execSync(
        `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`,
        {
          encoding: "utf-8",
          windowsHide: true,
        },
      ).trim();

      // Clean up script file
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Ignore cleanup errors
      }

      if (result !== "ok") {
        throw new Error("No image found in clipboard");
      }
    } catch (error) {
      // Clean up script file on error
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to save clipboard image: ${error}`);
    }
  } else if (platform === "darwin") {
    // macOS: Use AppleScript
    try {
      // Dynamic import to avoid errors on Windows
      const { runAppleScript } = await import("@raycast/utils");

      const script = `
        use framework "Foundation"
        use framework "AppKit"
        
        property NSString : a reference to current application's NSString
        property NSData : a reference to current application's NSData
        property NSPasteboard : a reference to current application's NSPasteboard
        property NSBitmapImageRep : a reference to current application's NSBitmapImageRep
        property NSImage : a reference to current application's NSImage
        
        on run argv
          set targetPath to item 1 of argv
          set pb to NSPasteboard's generalPasteboard()
          
          if (pb's canReadItemWithDataConformingToTypes:{"public.image"}) then
            set imageClasses to {current application's NSImage}
            set imageObjects to pb's readObjectsForClasses:imageClasses options:(missing value)
            
            if (count of imageObjects) > 0 then
              set theImage to item 1 of imageObjects
              set tiffData to theImage's TIFFRepresentation()
              
              if tiffData is not missing value then
                set bitmapRep to NSBitmapImageRep's imageRepWithData:tiffData
                set pngData to bitmapRep's representationUsingType:(current application's NSBitmapImageFileTypePNG) properties:(missing value)
                
                if pngData is not missing value then
                  pngData's writeToFile:targetPath atomically:true
                  return "ok"
                end if
              end if
            end if
          end if
          
          return "error"
        end run
      `;

      const result = await runAppleScript(script, [filepath]);
      if (result !== "ok") {
        throw new Error("No image found in clipboard");
      }
    } catch (error) {
      if (String(error).includes("No image found")) {
        throw error;
      }
      throw new Error(`Failed to save clipboard image: ${error}`);
    }
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}
