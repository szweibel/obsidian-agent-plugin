import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianAgentPlugin from './main';
import * as fs from 'fs';
import * as path from 'path';

export interface ObsidianAgentSettings {
  claudeCodePath: string;
  customWorkflow: string;
  customMcpConfigPath: string;
}

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

Available Tools:

Obsidian-Specific MCP Tools:
- mcp__obsidian__list_pages() - List all markdown files, organized by folder
- mcp__obsidian__search_vault(query) - Full-text search across all notes
- mcp__obsidian__get_backlinks(page) - Find pages that link TO a specific page
- mcp__obsidian__get_outgoing_links(page) - Find links that a page links TO
- mcp__obsidian__get_daily_note(date?) - Get path to daily note (today or specific date)

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
- Examples:
  - Read("Daily/2025-10-13.md") ✅ | Bash("cat Daily/2025-10-13.md") ❌
  - Edit(".obsidian/app.json", old, new) ✅ | Bash("sed -i ...") ❌

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

// This is the editable workflow section
export const DEFAULT_WORKFLOW = `## Default Linking Philosophy

This plugin encourages a well-linked, interconnected vault (Zettelkasten-style):

LINKING GUIDELINES:
1. **Suggest meaningful links** - When organizing content, identify and create [[wiki links]] between related concepts
2. **Link concepts, not categories** - Link ideas with meaningful relationships rather than generic groupings
3. **Atomic notes** - Encourage focused, single-concept notes that can be richly interlinked
4. **Bidirectional thinking** - Links create automatic backlinks, building a knowledge graph
5. **Context over bare links** - Embed links in sentences that explain the relationship
   - Example: "This approach relates to [[Concept]] because it shares similar principles"

WHEN ORGANIZING:
- Look for existing notes that relate to new content
- Suggest creating atomic notes for distinct concepts
- When moving content between notes, add cross-links to related existing notes
- After creating new notes, suggest existing notes that could link to them

## Inbox Processing Workflow

Many users maintain an inbox note for quick captures. When asked to process or organize:

1. **Review the content** - Read through accumulated captures
2. **Identify distinct concepts** - Look for ideas that deserve their own notes
3. **Move to permanent notes** - Organize by topic into appropriate locations
4. **Add cross-links** - Connect new content to related existing notes
5. **Clean up the inbox** - Remove processed items to keep it clear
6. **Create backlink opportunities** - Suggest where new notes should be referenced

## Customization

**This is a starting point!** Customize this workflow in Settings to match your vault:
- Change folder structures to match your organization
- Adjust linking preferences (more or less aggressive)
- Specify your inbox note name and location
- Define your daily notes format and processing workflow
- Add specific rules for your personal knowledge management system

The agent will adapt to your customized workflow while maintaining the core organizational principles.`;

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
  claudeCodePath: '',
  customWorkflow: DEFAULT_WORKFLOW,
  customMcpConfigPath: '',
};

export async function detectClaudeCodePath(): Promise<string | null> {
  const possiblePaths = [
    // Linux/Mac
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    // Windows
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.promises.access(p, fs.constants.X_OK);
      return p;
    } catch {
      // Continue checking
    }
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

export class ObsidianAgentSettingTab extends PluginSettingTab {
  plugin: ObsidianAgentPlugin;

  constructor(app: App, plugin: ObsidianAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian Agent Settings' });

    // Claude Code CLI Path
    new Setting(containerEl)
      .setName('Claude Code CLI Path')
      .setDesc('Path to the Claude Code executable (claude or claude.exe)')
      .addText(text => text
        .setPlaceholder('/path/to/claude')
        .setValue(this.plugin.settings.claudeCodePath)
        .onChange(async (value) => {
          this.plugin.settings.claudeCodePath = value;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('Auto-Detect')
        .onClick(async () => {
          const detected = await detectClaudeCodePath();
          if (detected) {
            this.plugin.settings.claudeCodePath = detected;
            await this.plugin.saveSettings();
            this.display(); // Refresh UI
          } else {
            alert('Claude Code CLI not found. Please install Claude Code or set the path manually.');
          }
        }));

    // Custom Tools Config
    containerEl.createEl('h3', { text: 'Custom Tools' });
    containerEl.createEl('p', {
      text: 'Add your own tools by wrapping external scripts/commands. Tool commands are OS-specific (e.g., use "wsl python3" on Windows with WSL, "python3" on Linux/macOS).',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('Custom Tools Config Path')
      .setDesc('Path to JSON file with custom tool definitions. Supports ~ for home directory, absolute paths (C:\\ or /), or relative to vault.')
      .addText(text => text
        .setPlaceholder('~/my-tools.json')
        .setValue(this.plugin.settings.customMcpConfigPath)
        .onChange(async (value) => {
          this.plugin.settings.customMcpConfigPath = value;
          await this.plugin.saveSettings();
        }));

    // Custom Workflow
    containerEl.createEl('h3', { text: 'Custom Workflow' });
    containerEl.createEl('p', {
      text: 'Customize how the agent organizes your vault. Edit folder names, linking preferences, and daily notes workflow below. Core rules and tool descriptions are hardcoded and cannot be accidentally broken.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('Workflow Preferences')
      .setDesc('Edit your linking philosophy, daily notes workflow, and folder structure')
      .addTextArea(text => {
        text
          .setPlaceholder('Enter custom workflow...')
          .setValue(this.plugin.settings.customWorkflow)
          .onChange(async (value) => {
            this.plugin.settings.customWorkflow = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 15;
        text.inputEl.cols = 80;
        return text;
      });

    new Setting(containerEl)
      .addButton(button => button
        .setButtonText('Reset to Default')
        .setWarning()
        .onClick(async () => {
          if (confirm('Reset workflow to default? This will overwrite your customizations.')) {
            this.plugin.settings.customWorkflow = DEFAULT_WORKFLOW;
            await this.plugin.saveSettings();
            this.display(); // Refresh UI
          }
        }));

    // Info section
    containerEl.createEl('h3', { text: 'Customization Tips' });
    const ul = containerEl.createEl('ul');
    ul.createEl('li', { text: 'Change folder names (e.g., "Library/" → "Work/") to match your vault structure' });
    ul.createEl('li', { text: 'Update daily notes path (e.g., "Daily/" → "Journal/") if you use a different folder' });
    ul.createEl('li', { text: 'Adjust linking philosophy (more/less aggressive linking)' });
    ul.createEl('li', { text: 'Modify the weekly review workflow to match your PKM system' });
    ul.createEl('li', { text: 'Core rules and tool descriptions are protected and cannot be edited' });
  }
}
