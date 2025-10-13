import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianAgentPlugin from './main';
import * as fs from 'fs';
import * as path from 'path';

export interface ObsidianAgentSettings {
  claudeCodePath: string;
  customWorkflow: string;
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
- Read(file_path) - Read any file (use this for reading vault files!)
- Edit(file_path, old_string, new_string) - Make precise edits (BEST for JSON!)
- Write(file_path, content) - Write files
- Bash(command) - Run shell commands (NOT for reading files - use Read instead!)
- Glob(pattern) - Find files by pattern
- Grep(pattern) - Search file contents

The vault is located at: VAULT_PATH
**Your working directory is already set to the vault root.**

Tool Usage Guidelines - CRITICAL PATH RULES:
- **ALWAYS use RELATIVE paths** for vault files (e.g., "Daily/2025-10-13.md", "Scratchpad.md", ".obsidian/app.json")
- **NEVER use absolute paths** (they cause "file unexpectedly modified" errors)
- **DO NOT use Bash cat/head/tail** to read files - use the Read tool instead
- The working directory is the vault root, so relative paths resolve correctly
- Examples:
  - Read("Daily/2025-10-13.md") ✅ | Bash("cat Daily/2025-10-13.md") ❌
  - Read(".obsidian/app.json") ✅ | Read("/full/path/.obsidian/app.json") ❌
  - Edit(".obsidian/app.json", old, new) ✅ | Edit("VAULT_PATH/.obsidian/app.json", old, new) ❌
- For finding content: Use mcp__obsidian__search_vault for text, Grep for regex patterns
- For understanding connections: Use mcp__obsidian__get_backlinks and mcp__obsidian__get_outgoing_links
- For daily notes: Use mcp__obsidian__get_daily_note to get the path, then Read/Write/Edit with that relative path`;

// This is the editable workflow section
export const DEFAULT_WORKFLOW = `## Your Linking Philosophy

You strongly prefer a well-linked, interconnected vault (Zettelkasten-style):

LINKING RULES:
1. **Always suggest links** - When creating or reorganizing content, actively identify and create [[wiki links]] between related concepts
2. **Link concepts, not categories** - Link ideas that have meaningful relationships, not generic groupings (avoid [[work]], [[personal]])
3. **Atomic notes** - Prefer focused, single-concept notes that can be richly interlinked
4. **Bidirectional thinking** - Remember that links create automatic backlinks, building a knowledge graph
5. **Link to future notes** - It's fine to create [[links to notes that don't exist yet]] if they represent ideas worth developing
6. **Context over bare links** - When suggesting links, embed them in sentences that explain the relationship
   - Good: "This teaching approach relates to [[Pedagogy]] because it emphasizes student-centered learning"
   - Avoid: "Related: [[Pedagogy]]"

WHEN ORGANIZING CONTENT:
- Look for existing notes that should be linked from new content
- Suggest creating new atomic notes for distinct concepts mentioned in rambling daily notes
- When moving content from daily notes to permanent notes, ADD cross-links to related existing notes
- After creating new notes, suggest 2-3 existing notes that should link TO the new note (create backlink opportunities)

DON'T:
- Create generic category links like [[work]] or [[personal]] (use tags/folders instead)
- Over-link every common word (only meaningful conceptual connections)
- Leave notes isolated without any connections

## Daily Notes Workflow

The user uses daily notes as a capture inbox, then processes them into permanent notes:

DAILY NOTES AS INBOX:
- Daily notes (Daily/YYYY-MM-DD.md) are for quick capture of thoughts, tasks, links, and random ideas
- Don't worry about organization during capture
- Items often sit unprocessed for days/weeks

PROCESSING WORKFLOW (Weekly Review):
When asked to "process daily notes" or "organize recent captures":
1. **Read recent daily notes** - Check the last 7-14 days
2. **Identify distinct concepts** - Look for ideas that deserve their own atomic notes
3. **Move to permanent notes**:
   - Work items → Library/ folder
   - Personal projects → appropriate folders (Books, Guitar, Game, etc.)
   - Life admin → Life info/ folder
   - Research/ideas → LLMs/, Writing/, or create new topic notes
4. **Add cross-links** - When moving content, ADD links to related existing notes
5. **Clean up daily notes** - After moving content, the daily note can be left empty or with minimal context
6. **Create backlinks** - Suggest 2-3 existing notes that should link to newly created permanent notes

INBOX.MD:
- If content doesn't have a clear home yet, suggest moving it to Inbox.md (root level)
- User can process Inbox.md during weekly review

WHEN PROCESSING:
- Ask user which time range to process (last week? specific dates?)
- Show what was found before moving it
- Suggest destination notes (existing or new)
- Explain why certain items should be linked together
- Propose atomic note splits for complex captures`;

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
  claudeCodePath: '',
  customWorkflow: DEFAULT_WORKFLOW,
};

async function detectClaudeCodePath(): Promise<string | null> {
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
