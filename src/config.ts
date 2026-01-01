import * as fs from 'fs';
import * as path from 'path';

// This is hardcoded infrastructure that users shouldn't edit
export const BASE_PROMPT = `You are an AI assistant integrated into Obsidian, a markdown-based note-taking application.

CRITICAL RULES:

1. **ACTUALLY USE TOOLS** - When asked to do something, you MUST call the tools to do it
   - NEVER just describe what you would do
   - If you say "I read the page", you MUST have called the appropriate tool
   - The user expects REAL ACTIONS, not descriptions

2. **READ BEFORE YOU WRITE** - Before copying, moving, or reorganizing content:
   - You MUST read files to see the COMPLETE current content
   - Read ALL source pages fully before doing any work
   - Never work from memory or assume content

3. **BE THOROUGH** - When copying or moving content:
   - Include ALL links, formatting, and nested structure
   - Don't create summaries or simplified versions
   - Copy EVERYTHING, not just names or headlines

4. **PRESERVE FORMATTING** - Maintain markdown formatting exactly:
   - Keep all [[wiki links]], URLs, and formatting
   - Preserve heading levels, lists, and indentation
   - Keep YAML frontmatter if present

5. **WRITE NATURALLY** - When creating or editing note content, write directly and integratively:
   - AVOID meta-commentary that announces ideas:
     ❌ "This demonstrates the importance of..."
     ❌ "The key insight here is..."
     ❌ "This shows that..."
     ❌ "It's important to note..."
   - INSTEAD, integrate ideas naturally into the prose:
     ✅ Write arguments and explanations directly
     ✅ Let the content embody ideas rather than reflecting on them
     ✅ Make notes read like finished writing, not process documentation
   - Exception: Source citations and structured metadata are fine

Available Tools:

Obsidian-Specific MCP Tools:
- mcp__obsidian__list_pages() - List all markdown files, organized by folder
- mcp__obsidian__search_vault(query) - Full-text search across all notes
- mcp__obsidian__get_backlinks(page) - Find pages that link TO a specific page
- mcp__obsidian__get_outgoing_links(page) - Find links that a page links TO
- mcp__obsidian__get_daily_note(date?) - Get path to daily note (today or specific date)
- mcp__obsidian__lint_prose(file_path?, text?) - Check text for style issues and AI-isms

Claude Code Built-in Tools:
- Read(file_path) - Read any file
- Edit(file_path, old_string, new_string) - Make precise edits (BEST for JSON!)
- Write(file_path, content) - Write files
- Bash(command) - Run shell commands (mkdir, git, mv, cp, etc.)
- Glob(pattern) - Find files by pattern
- Grep(pattern) - Search file contents

The vault is located at: VAULT_PATH
**Your working directory is set to the vault root.**

Tool Usage Guidelines - CRITICAL PATH RULES:
- **ALWAYS use RELATIVE paths** for all vault files (e.g., "Daily/2025-10-13.md", "Scratchpad.md", ".obsidian/app.json")
- **NEVER use absolute paths** - they will fail
- The working directory is the vault root, so relative paths resolve correctly

File Operations:
- **For READING files**: Use Read("path/to/file.md") - NEVER use Bash cat/head/tail
- **For WRITING files**: Use Write("path/to/file.md", content) - NEVER use Bash echo/printf
- **For EDITING files**: Use Edit("path/to/file.md", old, new) - NEVER use Bash sed/awk
- **For READING .docx files**: Word documents must be converted first with pandoc
  - When user uploads a .docx file (shows up in .temp-uploads/), convert it:
  - Bash("pandoc '.temp-uploads/filename.docx' -t markdown") to read as markdown
  - OR Bash("pandoc '.temp-uploads/filename.docx' -t plain") for plain text
  - Then work with the converted output
- Examples:
  - Read("Daily/2025-10-13.md") ✅ | Bash("cat Daily/2025-10-13.md") ❌
  - Edit(".obsidian/app.json", old, new) ✅ | Bash("sed -i ...") ❌
  - pandoc '.temp-uploads/doc.docx' -t plain ✅ for Word docs

System Operations (Bash is OK):
- **Creating directories**: Bash("mkdir -p Daily/2025-10") ✅
- **Moving files**: Bash("mv old.md new.md") ✅
- **Copying files**: Bash("cp src.md dest.md") ✅
- **Git operations**: Bash("git status") ✅
- **Listing files**: Bash("ls -la") ✅

Other Guidelines:
- For finding content: Use mcp__obsidian__search_vault for text, Grep for regex patterns
- For understanding connections: Use mcp__obsidian__get_backlinks and mcp__obsidian__get_outgoing_links
- For daily notes: Use mcp__obsidian__get_daily_note to get the path, then Read/Write/Edit with that relative path`;

export async function detectClaudeCodePath(): Promise<string | null> {
  const possiblePaths = [
    // Linux/Mac
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',  // Homebrew on Apple Silicon
    '/usr/local/bin/claude',     // Homebrew on Intel Mac / manual install
    '/usr/bin/claude',
    // Windows
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.promises.access(p, fs.constants.X_OK);

      // Check if it's a #!/usr/bin/env node script (won't work in GUI apps)
      const content = await fs.promises.readFile(p, 'utf8');
      const firstLine = content.split('\n')[0];

      if (firstLine.includes('#!/usr/bin/env node')) {
        // Need to create a wrapper - find node in same directory or common locations
        const dir = path.dirname(p);
        const nodePaths = [
          path.join(dir, 'node'),  // Same dir (Homebrew)
          '/opt/homebrew/bin/node',
          '/usr/local/bin/node',
          '/usr/bin/node',
        ];

        let nodePath: string | null = null;
        for (const np of nodePaths) {
          try {
            await fs.promises.access(np, fs.constants.X_OK);
            nodePath = np;
            break;
          } catch {
            // Continue
          }
        }

        if (nodePath) {
          const wrapperDir = path.join(process.env.HOME || '', '.cache', 'obsidian-agent');
          const wrapperPath = path.join(wrapperDir, 'claude-wrapper');

          try {
            await fs.promises.mkdir(wrapperDir, { recursive: true });
            const wrapperScript = `#!/bin/bash
# Auto-generated wrapper for Claude Code
# Bypasses #!/usr/bin/env node which doesn't work in GUI apps
exec "${nodePath}" "${p}" "$@"
`;
            await fs.promises.writeFile(wrapperPath, wrapperScript, { mode: 0o755 });
            console.log(`[ObsidianAgent] Created wrapper: ${wrapperPath} (node: ${nodePath}, claude: ${p})`);
            return wrapperPath;
          } catch (err) {
            console.warn(`[ObsidianAgent] Failed to create wrapper:`, err);
            return p;  // Fall back to direct path
          }
        }
      }

      return p;
    } catch {
      // Continue checking
    }
  }

  // Check NVM installations (Node Version Manager)
  // NVM-installed scripts use #!/usr/bin/env node which fails in GUI apps
  // Create a wrapper script that hard-codes paths
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');

  try {
    const versions = await fs.promises.readdir(versionsDir);
    // Sort versions in reverse to check newest first
    versions.sort().reverse();

    for (const version of versions) {
      const claudePath = path.join(versionsDir, version, 'bin', 'claude');
      try {
        await fs.promises.access(claudePath, fs.constants.X_OK);

        // Found NVM installation - check if it needs a wrapper
        const nodePath = path.join(versionsDir, version, 'bin', 'node');

        // Read the claude script to see if it uses #!/usr/bin/env
        try {
          const claudeContent = await fs.promises.readFile(claudePath, 'utf8');
          const firstLine = claudeContent.split('\n')[0];

          // If it uses #!/usr/bin/env node, create a wrapper
          if (firstLine.includes('#!/usr/bin/env node')) {
            const wrapperDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.cache', 'obsidian-agent');
            const wrapperPath = path.join(wrapperDir, 'claude-wrapper');

            // Try to create wrapper directory and script
            try {
              // Create wrapper directory if needed
              await fs.promises.mkdir(wrapperDir, { recursive: true });
              console.log(`[ObsidianAgent] Created wrapper directory: ${wrapperDir}`);

              // Create wrapper that executes the claude script with the NVM node
              // This wrapper auto-detects the current NVM version, so it adapts if the user switches node versions
              const wrapperScript = `#!/bin/bash
# Auto-generated wrapper for Claude Code (NVM installation)
# This bypasses #!/usr/bin/env node which doesn't work in GUI apps
# Auto-detects current NVM version with claude installed

NVM_DIR="\${NVM_DIR:-$HOME/.nvm}"

# Try to find the latest node version with claude installed
if [ -d "$NVM_DIR/versions/node" ]; then
  for version in $(ls -r "$NVM_DIR/versions/node" 2>/dev/null); do
    if [ -x "$NVM_DIR/versions/node/$version/bin/claude" ]; then
      NODE="$NVM_DIR/versions/node/$version/bin/node"
      CLAUDE="$NVM_DIR/versions/node/$version/bin/claude"
      exec "$NODE" "$CLAUDE" "$@"
    fi
  done
fi

# Fallback to hardcoded paths from initial detection
NODE="${nodePath}"
CLAUDE="${claudePath}"
exec "$NODE" "$CLAUDE" "$@"
`;

              await fs.promises.writeFile(wrapperPath, wrapperScript, { mode: 0o755 });
              console.log(`[ObsidianAgent] Created wrapper script: ${wrapperPath}`);
              return wrapperPath;
            } catch (wrapperError) {
              console.warn(`[ObsidianAgent] Failed to create wrapper script:`, wrapperError);
              console.log(`[ObsidianAgent] Falling back to direct NVM path (may not work in GUI): ${claudePath}`);
              // Fall back to returning the direct path
              // This might not work in GUI apps, but it's better than nothing
              return claudePath;
            }
          } else {
            // Not a #!/usr/bin/env script, can use directly
            return claudePath;
          }
        } catch {
          // Can't read the file, skip this version
          continue;
        }
      } catch {
        // Continue checking
      }
    }
  } catch {
    // NVM directory doesn't exist, continue
  }

  // Check PATH
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');

  for (const dir of pathDirs) {
    const claudePath = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    try {
      await fs.promises.access(claudePath, fs.constants.X_OK);
      return claudePath;
    } catch {
      // Continue checking
    }
  }

  return null;
}
