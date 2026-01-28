# GitHub Image Bed

A Raycast extension for uploading images to GitHub as an image hosting service with CDN acceleration support.

## Features

- 📷 **Upload images from clipboard** - Simply copy an image and run the command
- ⚡ **CDN acceleration** - Use jsDelivr or other CDN services for faster image loading
- 📋 **Multiple output formats** - Copy as Markdown, HTML, or direct URL
- ⚙️ **Configurable settings** - Customize repository, branch, path, and CDN URL template

1. Clone this repository to your local machine
2. Run `npm install` in the extension directory
3. Run `npm run dev` to start developing
4. In Raycast, the extension will appear automatically

## Configuration

Before using, configure the extension preferences in Raycast:

| Preference       | Description                                        | Required |
| ---------------- | -------------------------------------------------- | -------- |
| GitHub Token     | Personal Access Token with `repo` scope            | ✅       |
| Repository Owner | Your GitHub username or organization               | ✅       |
| Repository Name  | The repository to upload images to                 | ✅       |
| Branch           | Branch name (default: `main`)                      | ❌       |
| Upload Path      | Folder path in the repository (default: `images/`) | ❌       |
| Committer Email  | Email for commit messages                          | ✅       |
| CDN URL Template | Custom CDN URL (default: jsDelivr)                 | ❌       |
| Default Format   | Default output format (Markdown/URL/HTML)          | ❌       |

### CDN URL Template

The default CDN URL template uses jsDelivr:

```
https://fastly.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}
```

Available placeholders:

- `{owner}` - Repository owner
- `{repo}` - Repository name
- `{branch}` - Branch name
- `{path}` - Full file path including filename

### Getting a GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a descriptive name
4. Select the `repo` scope
5. Click "Generate token"
6. Copy the token and paste it in the extension preferences

## Usage

### Quick Upload (No View)

1. Copy an image to clipboard (screenshot or copy file from Finder)
2. Open Raycast and search for "Upload Image"
3. The image will be uploaded and the URL copied to clipboard automatically

### Upload with Options (List View)

1. Copy an image to clipboard
2. Open Raycast and search for "Upload Image with Options"
3. After upload, choose your preferred format (Markdown/URL/HTML)
4. Press Enter to copy the selected format

## Commands

| Command                   | Description                        | Mode      |
| ------------------------- | ---------------------------------- | --------- |
| Upload Image              | Quick upload and copy to clipboard | No View   |
| Upload Image with Options | Upload and choose output format    | List View |

## License

MIT
