import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianAgentPlugin from './main';
import { BASE_PROMPT, detectClaudeCodePath } from './config';

// Re-export for backward compatibility
export { BASE_PROMPT, detectClaudeCodePath };

export interface ObsidianAgentSettings {
  claudeCodePath: string;
  customWorkflow: string;
  customMcpConfigPath: string;
  requireEditApproval: boolean;
  enableProseLinting: boolean;
}

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

## OpenAlex Collection Development Workflow

When searching for books using OpenAlex, follow the complete workflow documented in the Collection Development Quick Reference.

**See:** [[Collection Development Quick Reference#📖 OpenAlex Book Discovery Workflow]]

**Key Points:**
1. Search OpenAlex - results include isbn_summary showing which books need ISBNs
2. Save results to temp file
3. **ISBN ENRICHMENT WITH VALIDATION (Two Steps)** - If books_without_isbn > 0:
   - **Step 3a:** Launch subagent to validate ISBNs (generates report only)
     - Subagent extracts ISBNs from publisher pages or DOI structure
     - Validates via Google Books API and OpenLibrary API
     - Cross-checks title/author against OpenAlex data
     - Reports which ISBNs passed validation (does NOT edit JSON file)
   - **Step 3b:** Review validation report and update JSON file
     - For each book with PASS validation, use Edit to add ISBN to results file
     - Skip books that failed validation
   - Note: Very new books (2024-2025) may only validate with OpenLibrary (Google Books lags)
   - Fallback: Manual WebFetch + Edit if subagent struggles
4. **VERIFY ISBNs** - All selected books MUST have verified ISBNs
5. Check Primo ONLY for books with verified ISBNs - Never fabricate or guess ISBNs
6. Create notes using create_book_notes tool (prevents metadata mixing)
7. Clean up temp files

**Critical Rules:**
- Every book must have a verified ISBN before Primo search or note creation
- Use subagent for ISBN enrichment (test & evaluate performance)
- If ISBN cannot be found after enrichment attempts, skip that book

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
  requireEditApproval: false,
  enableProseLinting: true,
};

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

    // Require Edit Approval
    new Setting(containerEl)
      .setName('Require Edit Approval')
      .setDesc('When enabled, you must approve file edits before they are applied')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.requireEditApproval)
        .onChange(async (value) => {
          this.plugin.settings.requireEditApproval = value;
          await this.plugin.saveSettings();
        }));

    // Prose Linting
    new Setting(containerEl)
      .setName('Enable Prose Linting')
      .setDesc('Analyze notes for style issues and AI-isms (overused AI phrases like "delve", "crucial", "it\'s important to note")')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableProseLinting)
        .onChange(async (value) => {
          this.plugin.settings.enableProseLinting = value;
          await this.plugin.saveSettings();
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
