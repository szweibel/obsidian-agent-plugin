import { Plugin, WorkspaceLeaf, ItemView, TFile, Notice, MarkdownRenderer } from 'obsidian';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, ObsidianAgentSettingTab, BASE_PROMPT } from './settings';

const VIEW_TYPE_AGENT_CHAT = 'agent-chat-view';

export default class ObsidianAgentPlugin extends Plugin {
  private vaultPath: string = '';
  settings: ObsidianAgentSettings;

  async onload() {
    console.log('[ObsidianAgent] Loading plugin...');
    console.log('[ObsidianAgent] Node.js version:', process.versions.node);
    console.log('[ObsidianAgent] Electron version:', process.versions.electron);
    console.log('[ObsidianAgent] Chrome version:', process.versions.chrome);

    // Load settings
    await this.loadSettings();

    this.vaultPath = (this.app.vault.adapter as any).basePath;
    console.log('[ObsidianAgent] Vault path:', this.vaultPath);

    // Register the chat view
    this.registerView(
      VIEW_TYPE_AGENT_CHAT,
      (leaf) => new AgentChatView(leaf, this)
    );

    // Add ribbon icon to open chat
    this.addRibbonIcon('bot', 'Open Agent Chat', () => {
      this.activateView();
    });

    // Add command to open chat
    this.addCommand({
      id: 'open-agent-chat',
      name: 'Open Agent Chat',
      callback: () => {
        this.activateView();
      }
    });

    // Add settings tab
    this.addSettingTab(new ObsidianAgentSettingTab(this.app, this));
  }

  async loadSettings() {
    const data = await this.loadData();

    // Migrate from old 'systemPrompt' to new 'customWorkflow' if needed
    if (data && 'systemPrompt' in data && !('customWorkflow' in data)) {
      console.log('[ObsidianAgent] Migrating settings from systemPrompt to customWorkflow');
      data.customWorkflow = data.systemPrompt;
      delete data.systemPrompt;
      // Save the migrated settings
      await this.saveData(data);
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  createTools() {
    const vaultPath = this.vaultPath;

    return [
      tool(
        'search_vault',
        'Search for text across all markdown files in the vault',
        z.object({
          query: z.string().describe('Search query to find in notes'),
        }).shape,
        async ({ query }) => {
          console.log('[ObsidianAgent] Tool: search_vault called with query:', query);
          try {
            const files = this.app.vault.getMarkdownFiles();
            const results: Array<{ file: string; matches: string[] }> = [];

            for (const file of files) {
              const content = await this.app.vault.read(file);
              const lines = content.split('\n');
              const matches: string[] = [];

              lines.forEach((line, idx) => {
                if (line.toLowerCase().includes(query.toLowerCase())) {
                  matches.push(`Line ${idx + 1}: ${line.trim()}`);
                }
              });

              if (matches.length > 0) {
                results.push({ file: file.path, matches });
              }
            }

            if (results.length === 0) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `No results found for "${query}"`,
                }],
              };
            }

            let text = `Found "${query}" in ${results.length} file(s):\n\n`;
            results.forEach(({ file, matches }) => {
              text += `**${file}**\n`;
              matches.slice(0, 5).forEach(match => {
                text += `  ${match}\n`;
              });
              if (matches.length > 5) {
                text += `  ... and ${matches.length - 5} more matches\n`;
              }
              text += '\n';
            });

            console.log('[ObsidianAgent] Search found', results.length, 'files');
            return {
              content: [{
                type: 'text' as const,
                text,
              }],
            };
          } catch (error: any) {
            console.error('[ObsidianAgent] Error searching vault:', error);
            return {
              content: [{
                type: 'text' as const,
                text: `Error searching vault: ${error.message}`,
              }],
            };
          }
        }
      ),

      tool(
        'get_daily_note',
        'Get the path to a daily note (today or specific date)',
        z.object({
          date: z.string().optional().describe('Date in YYYY-MM-DD format (optional, defaults to today)'),
        }).shape,
        async ({ date }) => {
          console.log('[ObsidianAgent] Tool: get_daily_note called with date:', date);
          try {
            const targetDate = date || new Date().toISOString().split('T')[0];
            const dailyNotePath = `Daily/${targetDate}.md`;
            const fullPath = path.join(vaultPath, dailyNotePath);

            // Check if it exists
            try {
              await fs.access(fullPath);
              return {
                content: [{
                  type: 'text' as const,
                  text: `Daily note path: ${dailyNotePath} (exists)`,
                }],
              };
            } catch {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Daily note path: ${dailyNotePath} (does not exist yet)`,
                }],
              };
            }
          } catch (error: any) {
            console.error('[ObsidianAgent] Error getting daily note:', error);
            return {
              content: [{
                type: 'text' as const,
                text: `Error getting daily note: ${error.message}`,
              }],
            };
          }
        }
      ),

      tool(
        'get_backlinks',
        'Get all pages that link TO a specific page',
        z.object({
          page: z.string().describe('Path to the page (e.g., "Library/Teaching.md")'),
        }).shape,
        async ({ page: pagePath }) => {
          console.log('[ObsidianAgent] Tool: get_backlinks called with page:', pagePath);
          try {
            const targetFile = this.app.vault.getAbstractFileByPath(pagePath);
            if (!targetFile || !(targetFile instanceof TFile)) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Page not found: ${pagePath}`,
                }],
              };
            }

            const backlinks: string[] = [];
            const files = this.app.vault.getMarkdownFiles();

            // Get the base name without extension for wiki link matching
            const baseName = targetFile.basename;

            for (const file of files) {
              if (file.path === pagePath) continue;

              const content = await this.app.vault.read(file);
              // Check for [[Page]] or [[Page|Alias]] style links
              if (content.includes(`[[${baseName}]]`) || content.includes(`[[${baseName}|`)) {
                backlinks.push(file.path);
              }
            }

            if (backlinks.length === 0) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `No pages link to ${pagePath}`,
                }],
              };
            }

            let text = `Pages linking to ${pagePath}:\n\n`;
            backlinks.forEach(link => {
              text += `- ${link}\n`;
            });

            console.log('[ObsidianAgent] Found', backlinks.length, 'backlinks');
            return {
              content: [{
                type: 'text' as const,
                text,
              }],
            };
          } catch (error: any) {
            console.error('[ObsidianAgent] Error getting backlinks:', error);
            return {
              content: [{
                type: 'text' as const,
                text: `Error getting backlinks: ${error.message}`,
              }],
            };
          }
        }
      ),

      tool(
        'get_outgoing_links',
        'Get all pages that a specific page links TO',
        z.object({
          page: z.string().describe('Path to the page (e.g., "Library/Teaching.md")'),
        }).shape,
        async ({ page: pagePath }) => {
          console.log('[ObsidianAgent] Tool: get_outgoing_links called with page:', pagePath);
          try {
            const targetFile = this.app.vault.getAbstractFileByPath(pagePath);
            if (!targetFile || !(targetFile instanceof TFile)) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Page not found: ${pagePath}`,
                }],
              };
            }

            const content = await this.app.vault.read(targetFile);
            // Match [[Link]] and [[Link|Alias]] patterns
            const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
            const matches = [...content.matchAll(linkPattern)];
            const links = matches.map(m => m[1]);

            if (links.length === 0) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `${pagePath} has no outgoing links`,
                }],
              };
            }

            let text = `Outgoing links from ${pagePath}:\n\n`;
            links.forEach(link => {
              text += `- [[${link}]]\n`;
            });

            console.log('[ObsidianAgent] Found', links.length, 'outgoing links');
            return {
              content: [{
                type: 'text' as const,
                text,
              }],
            };
          } catch (error: any) {
            console.error('[ObsidianAgent] Error getting outgoing links:', error);
            return {
              content: [{
                type: 'text' as const,
                text: `Error getting outgoing links: ${error.message}`,
              }],
            };
          }
        }
      ),

      tool(
        'list_pages',
        'List all markdown pages in the vault, organized by folder',
        z.object({}).shape,
        async () => {
          console.log('[ObsidianAgent] Tool: list_pages called');
          const files = this.app.vault.getMarkdownFiles();
          const organized: Record<string, string[]> = {};

          files.forEach((file: TFile) => {
            const folder = file.parent?.path || 'root';
            if (!organized[folder]) {
              organized[folder] = [];
            }
            organized[folder].push(file.path);
          });

          console.log('[ObsidianAgent] Found', files.length, 'markdown files');

          let text = 'Markdown files in vault:\n\n';
          for (const [folder, fileList] of Object.entries(organized)) {
            text += `**${folder}/**\n`;
            fileList.forEach(f => {
              text += `- ${f}\n`;
            });
            text += '\n';
          }

          return {
            content: [{
              type: 'text' as const,
              text,
            }],
          };
        }
      ),
    ];
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT_CHAT);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_AGENT_CHAT, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async sendQuery(userQuery: string, sessionId?: string): Promise<AsyncIterable<any>> {
    console.log('[ObsidianAgent] Starting query:', userQuery);
    console.log('[ObsidianAgent] Current working directory:', process.cwd());
    console.log('[ObsidianAgent] Environment check:', {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
    });

    // Fix HOME environment variable for Windows
    if (!process.env.HOME && process.env.USERPROFILE) {
      console.log('[ObsidianAgent] Setting HOME to USERPROFILE for Windows compatibility');
      process.env.HOME = process.env.USERPROFILE;
    }

    // Set working directory to vault path if not set
    if (!process.cwd() || process.cwd() === '/') {
      console.log('[ObsidianAgent] Setting cwd to vault path:', this.vaultPath);
      try {
        process.chdir(this.vaultPath);
      } catch (e) {
        console.warn('[ObsidianAgent] Could not change directory:', e);
      }
    }

    // Create MCP server with tools
    console.log('[ObsidianAgent] Creating MCP server with tools...');
    const server = createSdkMcpServer({
      name: 'obsidian',
      version: '1.0.0',
      tools: this.createTools(),
    });
    console.log('[ObsidianAgent] MCP server created');

    console.log('[ObsidianAgent] Calling Agent SDK query...');

    // Combine BASE_PROMPT with user's customWorkflow and replace VAULT_PATH
    const systemPrompt = `${BASE_PROMPT}\n\n${this.settings.customWorkflow}`.replace(/VAULT_PATH/g, this.vaultPath);

    const queryOptions: any = {
      pathToClaudeCodeExecutable: this.settings.claudeCodePath || undefined,
      permissionMode: 'bypassPermissions',
      systemPrompt: systemPrompt,
      mcpServers: {
        obsidian: server,
      },
    };

    // If we have a session ID, resume the conversation
    if (sessionId) {
      console.log('[ObsidianAgent] Resuming session:', sessionId);
      queryOptions.resume = sessionId;
    }

    return query({
      prompt: userQuery,
      options: queryOptions,
    });
  }

  onunload() {
    console.log('[ObsidianAgent] Unloading plugin');
  }
}

class AgentChatView extends ItemView {
  private plugin: ObsidianAgentPlugin;
  private messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private isLoading = false;
  private sessionId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT_CHAT;
  }

  getDisplayText(): string {
    return 'Agent Chat';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('agent-chat-container');

    // Create messages container
    const messagesContainer = container.createDiv('agent-messages');

    // Create input container
    const inputContainer = container.createDiv('agent-input-container');

    const textarea = inputContainer.createEl('textarea', {
      placeholder: 'Ask the agent to help organize your vault...',
      cls: 'agent-input'
    });

    const sendButton = inputContainer.createEl('button', {
      text: 'Send',
      cls: 'agent-send-button'
    });

    const clearButton = inputContainer.createEl('button', {
      text: 'Clear',
      cls: 'agent-clear-button'
    });

    const handleSend = async () => {
      const queryText = textarea.value.trim();
      if (!queryText || this.isLoading) return;

      textarea.value = '';
      this.isLoading = true;
      sendButton.disabled = true;

      // Add user message
      this.addMessage(messagesContainer, 'user', queryText);

      // Add loading indicator
      const loadingEl = messagesContainer.createDiv('agent-message assistant loading');
      loadingEl.setText('Thinking...');

      try {
        console.log('[ObsidianAgent] Getting query stream...');
        const stream = await this.plugin.sendQuery(queryText, this.sessionId || undefined);
        console.log('[ObsidianAgent] Query stream obtained, processing events...');
        let fullResponse = '';

        loadingEl.remove();
        const assistantEl = messagesContainer.createDiv('agent-message assistant');

        for await (const event of stream) {
          console.log('[ObsidianAgent] Stream event:', event.type, event);

          // Capture session ID from first system init event
          if (event.type === 'system' && event.subtype === 'init' && !this.sessionId) {
            this.sessionId = event.session_id;
            console.log('[ObsidianAgent] Session started:', this.sessionId);
          }

          if (event.type === 'assistant') {
            // Extract text from message content
            const message = event.message;
            if (message.content && Array.isArray(message.content)) {
              for (const block of message.content) {
                if (block.type === 'text') {
                  fullResponse += block.text;
                } else if (block.type === 'tool_use') {
                  fullResponse += `\n\n*🔧 ${block.name}*\n`;
                }
              }
              // Render markdown
              assistantEl.empty();
              await MarkdownRenderer.renderMarkdown(
                fullResponse,
                assistantEl,
                '/',  // Use vault root as source path for link resolution
                this
              );

              // Make internal links clickable
              assistantEl.querySelectorAll('a.internal-link').forEach((link: HTMLElement) => {
                link.addEventListener('click', (e) => {
                  e.preventDefault();
                  const href = link.getAttribute('data-href');
                  if (href) {
                    // Open the linked file
                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(href, '/');
                    if (file) {
                      this.plugin.app.workspace.getLeaf(false).openFile(file);
                    }
                  }
                });
              });

              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
          }
        }

        console.log('[ObsidianAgent] Query completed successfully');
        this.messages.push({ role: 'assistant', content: fullResponse });
      } catch (error: any) {
        console.error('[ObsidianAgent] Query error:', error);
        console.error('[ObsidianAgent] Error stack:', error.stack);
        loadingEl.remove();
        const errorMessage = `Error: ${error.message}\n\nCheck browser console (F12) for details.`;
        new Notice(errorMessage);
        this.addMessage(messagesContainer, 'assistant', errorMessage);
      } finally {
        this.isLoading = false;
        sendButton.disabled = false;
        textarea.focus();
      }
    };

    clearButton.addEventListener('click', () => {
      // Clear the UI
      messagesContainer.empty();
      // Reset session and messages
      this.sessionId = null;
      this.messages = [];
      console.log('[ObsidianAgent] Chat cleared, session reset');
    });

    sendButton.addEventListener('click', handleSend);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Add some CSS
    this.addStyles();
  }

  async addMessage(container: HTMLElement, role: 'user' | 'assistant', content: string) {
    const messageEl = container.createDiv(`agent-message ${role}`);

    if (role === 'assistant') {
      // Render markdown for assistant messages
      await MarkdownRenderer.renderMarkdown(content, messageEl, '/', this);

      // Make internal links clickable
      messageEl.querySelectorAll('a.internal-link').forEach((link: HTMLElement) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const href = link.getAttribute('data-href');
          if (href) {
            // Open the linked file
            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(href, '/');
            if (file) {
              this.plugin.app.workspace.getLeaf(false).openFile(file);
            }
          }
        });
      });
    } else {
      // Plain text for user messages
      messageEl.setText(content);
    }

    container.scrollTop = container.scrollHeight;
    this.messages.push({ role, content });
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .agent-chat-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 10px;
      }

      .agent-messages {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .agent-message {
        padding: 10px;
        border-radius: 6px;
        max-width: 85%;
      }

      .agent-message.user {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        align-self: flex-end;
      }

      .agent-message.assistant {
        background: var(--background-secondary);
        align-self: flex-start;
        word-wrap: break-word;
      }

      .agent-message.assistant * {
        user-select: text;
        cursor: text;
      }

      .agent-message.assistant a.internal-link {
        cursor: pointer;
        color: var(--link-color);
        text-decoration: none;
      }

      .agent-message.assistant a.internal-link:hover {
        text-decoration: underline;
      }

      /* Reduce spacing in markdown-rendered content */
      .agent-message.assistant p {
        margin: 0;
        margin-bottom: 0.15em;
        line-height: 1.4;
      }

      .agent-message.assistant p:first-child {
        margin-top: 0;
      }

      .agent-message.assistant p:last-child {
        margin-bottom: 0;
      }

      .agent-message.assistant ul,
      .agent-message.assistant ol {
        margin: 0;
        margin-bottom: 0.2em;
        padding-left: 1.5em;
        line-height: 1.3;
      }

      .agent-message.assistant li {
        margin: 0;
        padding: 0;
        line-height: 1.3;
      }

      .agent-message.assistant li:last-child {
        margin-bottom: 0;
      }

      .agent-message.assistant li p {
        margin: 0;
        display: inline;
      }

      .agent-message.assistant h1,
      .agent-message.assistant h2,
      .agent-message.assistant h3,
      .agent-message.assistant h4 {
        margin: 0;
        margin-top: 0.5em;
        margin-bottom: 0.2em;
      }

      .agent-message.assistant h1:first-child,
      .agent-message.assistant h2:first-child,
      .agent-message.assistant h3:first-child,
      .agent-message.assistant h4:first-child {
        margin-top: 0;
      }

      .agent-message.assistant code {
        margin: 0;
        padding: 0.1em 0.3em;
      }

      .agent-message.assistant pre {
        margin: 0;
        margin-bottom: 0.3em;
      }

      .agent-message.assistant pre:last-child {
        margin-bottom: 0;
      }

      .agent-message.loading {
        opacity: 0.7;
        font-style: italic;
      }

      .tool-call {
        font-size: 0.9em;
        opacity: 0.7;
        margin-top: 4px;
      }

      .agent-input-container {
        display: flex;
        gap: 8px;
      }

      .agent-input {
        flex: 1;
        min-height: 60px;
        padding: 8px;
        border-radius: 4px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        resize: vertical;
      }

      .agent-send-button {
        padding: 8px 16px;
        border-radius: 4px;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border: none;
        cursor: pointer;
      }

      .agent-send-button:hover {
        background: var(--interactive-accent-hover);
      }

      .agent-send-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .agent-clear-button {
        padding: 8px 16px;
        border-radius: 4px;
        background: var(--background-modifier-error);
        color: var(--text-on-accent);
        border: none;
        cursor: pointer;
      }

      .agent-clear-button:hover {
        background: var(--background-modifier-error-hover);
        opacity: 0.8;
      }
    `;
    document.head.appendChild(style);
  }

  async onClose() {
    // Clean up
  }
}
