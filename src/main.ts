import { Plugin, WorkspaceLeaf, ItemView, TFile, Notice, MarkdownRenderer } from 'obsidian';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, ObsidianAgentSettingTab, BASE_PROMPT, detectClaudeCodePath } from './settings';
import { ChangeTracker, FileChange } from './diff-utils';

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
      hotkeys: [
        {
          modifiers: ['Mod', 'Shift'],
          key: 'A',
        }
      ],
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

    // Auto-detect Claude Code path if not set
    if (!this.settings.claudeCodePath) {
      console.log('[ObsidianAgent] Claude Code path not set, attempting auto-detection...');
      const detectedPath = await detectClaudeCodePath();
      if (detectedPath) {
        console.log('[ObsidianAgent] Auto-detected Claude Code at:', detectedPath);
        this.settings.claudeCodePath = detectedPath;
        await this.saveSettings();
      } else {
        console.log('[ObsidianAgent] Could not auto-detect Claude Code path');
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadCustomTools(): Promise<any[]> {
    if (!this.settings.customMcpConfigPath) {
      return [];
    }

    try {
      let configPath = this.settings.customMcpConfigPath.trim();

      // Handle ~ expansion
      if (configPath.startsWith('~')) {
        configPath = configPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
      }

      // Check if path is absolute (Windows or Unix)
      const isAbsolute = path.isAbsolute(configPath);
      if (!isAbsolute) {
        // If relative, resolve from vault path
        configPath = path.resolve(this.vaultPath, configPath);
      }

      console.log('[ObsidianAgent] Loading custom tools from:', configPath);

      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      if (!config.tools || !Array.isArray(config.tools)) {
        console.warn('[ObsidianAgent] Config must have a "tools" array');
        return [];
      }

      console.log('[ObsidianAgent] Loaded custom tools:', config.tools.map((t: any) => t.name));
      return config.tools;
    } catch (error: any) {
      console.error('[ObsidianAgent] Failed to load custom tools:', error.message);
      new Notice(`Failed to load custom tools: ${error.message}`);
      return [];
    }
  }

  createToolWrapper(toolDef: any) {
    // Build Zod schema from parameters
    const schemaFields: Record<string, any> = {};
    if (toolDef.parameters) {
      for (const [paramName, paramDef] of Object.entries(toolDef.parameters as any)) {
        let zodType = z.string(); // Default to string

        if (paramDef.type === 'number' || paramDef.type === 'integer') {
          zodType = z.number();
        } else if (paramDef.type === 'boolean') {
          zodType = z.boolean();
        }

        if (paramDef.optional) {
          zodType = zodType.optional();
        }

        if (paramDef.description) {
          zodType = zodType.describe(paramDef.description);
        }

        schemaFields[paramName] = zodType;
      }
    }

    return tool(
      toolDef.name,
      toolDef.description,
      z.object(schemaFields).shape,
      async (params: any) => {
        try {
          console.log(`[ObsidianAgent] Executing custom tool: ${toolDef.name}`, params);

          // Build command args with parameters
          const args = [...(toolDef.args || [])];

          // Add parameters as command-line flags
          // Use separate arguments instead of --key=value to handle spaces
          for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
              args.push(`--${key}`);
              args.push(String(value));
            }
          }

          // Build environment variables
          const env = { ...process.env, ...(toolDef.env || {}) };

          console.log(`[ObsidianAgent] Executing with env:`, Object.keys(toolDef.env || {}).join(', '));

          // Special handling for WSL: env vars don't pass through automatically
          let finalCommand = toolDef.command;
          let finalArgs = [...args];

          if (toolDef.command.toLowerCase() === 'wsl' && toolDef.env && Object.keys(toolDef.env).length > 0) {
            // For WSL, inject env var assignments as separate arguments
            // Format: wsl PRIMO_API_KEY=value PRIMO_VID=value python3 script.py args...
            const envArgs = Object.entries(toolDef.env)
              .map(([key, value]) => `${key}=${value}`);
            finalArgs = [...envArgs, ...args];
            console.log(`[ObsidianAgent] WSL command with env:`, finalCommand, finalArgs.join(' '));
          } else {
            console.log(`[ObsidianAgent] Full command:`, finalCommand, finalArgs.join(' '));
          }

          // Execute command using Node.js child_process
          const { spawn } = require('child_process');

          return new Promise((resolve) => {
            const proc = spawn(finalCommand, finalArgs, { env });
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => {
              stdout += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });

            proc.on('close', (code: number) => {
              if (code !== 0) {
                console.error(`[ObsidianAgent] Tool ${toolDef.name} failed:`, stderr);
                resolve({
                  content: [{
                    type: 'text' as const,
                    text: `Error executing ${toolDef.name}: ${stderr || 'Command failed'}`,
                  }],
                });
                return;
              }

              // Try to parse JSON output
              try {
                const result = JSON.parse(stdout);
                const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                resolve({
                  content: [{
                    type: 'text' as const,
                    text: resultText,
                  }],
                });
              } catch (parseError) {
                // If not JSON, return raw output
                resolve({
                  content: [{
                    type: 'text' as const,
                    text: stdout,
                  }],
                });
              }
            });
          });
        } catch (error: any) {
          console.error(`[ObsidianAgent] Error in custom tool ${toolDef.name}:`, error);
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${error.message}`,
            }],
          };
        }
      }
    );
  }

  async createTools() {
    const vaultPath = this.vaultPath;

    const builtInTools = [
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

    // Load and add custom tools
    const customToolDefs = await this.loadCustomTools();
    const customTools = customToolDefs.map(def => this.createToolWrapper(def));

    return [...builtInTools, ...customTools];
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

  async sendQuery(userQuery: string, sessionId?: string, abortSignal?: AbortSignal, attachment?: { name: string; data: string; type: string }): Promise<AsyncIterable<any>> {
    console.log('[ObsidianAgent] Starting query:', userQuery);
    if (attachment) {
      console.log('[ObsidianAgent] With attachment:', attachment.name, attachment.type);
    }
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

    // Create MCP server with all tools (built-in + custom)
    console.log('[ObsidianAgent] Creating MCP server with tools...');
    const allTools = await this.createTools();
    const server = createSdkMcpServer({
      name: 'obsidian',
      version: '1.0.0',
      tools: allTools,
    });
    console.log('[ObsidianAgent] MCP server created with', allTools.length, 'tools');

    console.log('[ObsidianAgent] Calling Agent SDK query...');

    // Combine BASE_PROMPT with user's customWorkflow and replace VAULT_PATH
    const systemPrompt = `${BASE_PROMPT}\n\n${this.settings.customWorkflow}`.replace(/VAULT_PATH/g, this.vaultPath);

    const queryOptions: any = {
      pathToClaudeCodeExecutable: this.settings.claudeCodePath || undefined,
      permissionMode: 'bypassPermissions',
      systemPrompt: systemPrompt,
      cwd: this.vaultPath,  // Set working directory for Claude Code CLI
      mcpServers: {
        obsidian: server,
      },
    };

    // If we have a session ID, resume the conversation
    if (sessionId) {
      console.log('[ObsidianAgent] Resuming session:', sessionId);
      queryOptions.resume = sessionId;
    }

    // If we have an abort signal, create AbortController for it
    if (abortSignal) {
      const controller = new AbortController();
      abortSignal.addEventListener('abort', () => controller.abort());
      queryOptions.abortController = controller;
    }

    // Construct prompt with file attachment if present
    let prompt: any = userQuery;

    if (attachment) {
      // Agent SDK doesn't support inline attachments - save to temp and reference path
      const tempDir = path.join(this.vaultPath, '.temp-uploads');
      const tempPath = path.join(tempDir, attachment.name);

      try {
        console.log('[ObsidianAgent] Saving attachment to:', tempPath);
        await fs.mkdir(tempDir, { recursive: true });

        // Write file based on type
        if (attachment.type.startsWith('image/') || attachment.type === 'application/pdf') {
          // For images/PDFs, write base64 data as binary
          const base64Data = attachment.data.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          await fs.writeFile(tempPath, buffer);
          console.log('[ObsidianAgent] Saved binary file:', attachment.type);
        } else {
          // For text files, write as UTF-8
          await fs.writeFile(tempPath, attachment.data, 'utf-8');
          console.log('[ObsidianAgent] Saved text file');
        }

        // Use simple string prompt - Claude will use Read tool to access it
        prompt = `${userQuery}\n\nI've uploaded a file: ${attachment.name}\nLocation: ${tempPath}\nPlease read and help me with it.`;
        console.log('[ObsidianAgent] Prompt with attachment:', prompt.substring(0, 200));
      } catch (err: any) {
        console.error('[ObsidianAgent] Error writing temp file:', err);
        // Fallback: inline for text files only
        if (!attachment.type.startsWith('image/') && attachment.type !== 'application/pdf') {
          prompt = `${userQuery}\n\nAttached file: ${attachment.name}\n\nContent:\n${attachment.data}`;
        } else {
          throw new Error(`Failed to save ${attachment.type} file: ${err.message}`);
        }
      }
    }

    console.log('[ObsidianAgent] About to call query with prompt type:', typeof prompt);
    if (typeof prompt === 'string') {
      console.log('[ObsidianAgent] Prompt string (first 300 chars):', prompt.substring(0, 300));
    }

    return query({
      prompt,
      options: queryOptions,
    });
  }

  onunload() {
    console.log('[ObsidianAgent] Unloading plugin');
  }
}

interface ToolUseData {
  id: string;
  name: string;
  input: any;
  result?: any;
  element?: HTMLElement;
  isExpanded: boolean;
  fileChange?: FileChange;
  fileStateBefore?: string | null;
}

class AgentChatView extends ItemView {
  private plugin: ObsidianAgentPlugin;
  private messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private isLoading = false;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private currentToolUses: Map<string, ToolUseData> = new Map();
  private changeTracker: ChangeTracker = new ChangeTracker();

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

    // Wrapper for textarea and file indicator
    const textareaWrapper = inputContainer.createDiv('agent-textarea-wrapper');

    // File indicator element (shown above textarea)
    const fileIndicator = textareaWrapper.createDiv('agent-file-indicator');
    fileIndicator.style.display = 'none';

    const textarea = textareaWrapper.createEl('textarea', {
      placeholder: 'Ask the agent to help organize your vault...',
      cls: 'agent-input'
    });

    const buttonContainer = inputContainer.createDiv('agent-button-container');

    // File upload button and hidden input
    const fileInput = inputContainer.createEl('input', {
      type: 'file',
      cls: 'agent-file-input'
    });
    fileInput.style.display = 'none';
    // Don't set accept attribute - allows all file types
    // fileInput.accept is intentionally not set

    const uploadButton = buttonContainer.createEl('button', {
      text: '📎',
      cls: 'agent-upload-button',
      attr: { title: 'Attach file' }
    });

    const sendButton = buttonContainer.createEl('button', {
      text: 'Send',
      cls: 'agent-send-button'
    });

    const stopButton = buttonContainer.createEl('button', {
      text: 'Stop',
      cls: 'agent-stop-button'
    });
    stopButton.style.display = 'none';

    const clearButton = buttonContainer.createEl('button', {
      text: 'Clear',
      cls: 'agent-clear-button'
    });

    // Store attached file
    let attachedFile: { name: string; data: string; type: string } | null = null;

    uploadButton.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        // Read file based on type
        if (file.type.startsWith('image/')) {
          // Convert image to base64
          const reader = new FileReader();
          reader.onload = () => {
            attachedFile = {
              name: file.name,
              data: reader.result as string,
              type: file.type
            };
            fileIndicator.setText(`📎 ${file.name}`);
            fileIndicator.style.display = 'block';
          };
          reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
          // For PDF, we'll send the file path or base64
          const reader = new FileReader();
          reader.onload = () => {
            attachedFile = {
              name: file.name,
              data: reader.result as string,
              type: file.type
            };
            fileIndicator.setText(`📎 ${file.name}`);
            fileIndicator.style.display = 'block';
          };
          reader.readAsDataURL(file);
        } else {
          // Text-based files (CSV, JSON, TXT, etc.)
          const reader = new FileReader();
          reader.onload = () => {
            attachedFile = {
              name: file.name,
              data: reader.result as string,
              type: file.type || 'text/plain'  // Preserve MIME type or default to text/plain
            };
            fileIndicator.setText(`📎 ${file.name}`);
            fileIndicator.style.display = 'block';
          };
          reader.readAsText(file);
        }
      } catch (error: any) {
        console.error('[ObsidianAgent] Error reading file:', error);
        new Notice(`Error reading file: ${error.message}`);
      }
    });

    const handleSend = async () => {
      const queryText = textarea.value.trim();
      if (!queryText || this.isLoading) return;

      textarea.value = '';
      this.isLoading = true;

      // Capture attached file and clear it
      const fileToSend = attachedFile;
      attachedFile = null;
      fileIndicator.style.display = 'none';
      fileInput.value = '';
      this.abortController = new AbortController();

      sendButton.style.display = 'none';
      stopButton.style.display = '';

      // Add user message with file indicator if present
      let displayText = queryText;
      if (fileToSend) {
        displayText += `\n\n📎 ${fileToSend.name}`;
      }
      this.addMessage(messagesContainer, 'user', displayText);

      // Add loading indicator
      const loadingEl = messagesContainer.createDiv('agent-message assistant loading');
      loadingEl.setText('Thinking');

      try {
        console.log('[ObsidianAgent] Getting query stream...');
        const stream = await this.plugin.sendQuery(queryText, this.sessionId || undefined, this.abortController.signal, fileToSend);
        console.log('[ObsidianAgent] Query stream obtained, processing events...');
        let fullResponse = '';
        this.currentToolUses.clear(); // Clear tool uses from previous query

        const assistantEl = messagesContainer.createDiv('agent-message assistant');
        let lastWasToolUse = false;
        let currentTextContainer: HTMLElement | null = null;
        let currentSectionText = '';
        let renderTimeout: NodeJS.Timeout | null = null;

        // Debounced render function
        const scheduleRender = () => {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
          }
          renderTimeout = setTimeout(() => performRender(), 150);
        };

        // Immediate render function
        const performRender = async () => {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }

          if (!currentTextContainer || !currentSectionText.trim()) return;

          currentTextContainer.empty();
          await MarkdownRenderer.renderMarkdown(
            currentSectionText,
            currentTextContainer,
            '/',
            this
          );

          this.fixOverflowOnElement(currentTextContainer);

          // Make internal links clickable
          currentTextContainer.querySelectorAll('a.internal-link').forEach((link: HTMLElement) => {
            link.addEventListener('click', (e) => {
              e.preventDefault();
              const href = link.getAttribute('data-href');
              if (href) {
                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(href, '/');
                if (file) {
                  this.plugin.app.workspace.getLeaf(false).openFile(file);
                }
              }
            });
          });

          // Scroll to bottom
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        };

        for await (const event of stream) {
          console.log('[ObsidianAgent] Stream event:', event.type, 'subtype:', event.subtype, event);

          // Capture session ID from first system init event
          if (event.type === 'system' && event.subtype === 'init' && !this.sessionId) {
            this.sessionId = event.session_id;
            console.log('[ObsidianAgent] Session started:', this.sessionId);
          }

          if (event.type === 'assistant') {
            // Extract text from message content
            const message = event.message;
            if (message.content && Array.isArray(message.content)) {
              // Process each block incrementally
              for (const block of message.content) {
                if (block.type === 'text') {
                  fullResponse += block.text;
                  currentSectionText += block.text;

                  // Hide thinking indicator when we get text content
                  if (loadingEl.isConnected) {
                    loadingEl.style.display = 'none';
                  }

                  // Create text container if needed
                  if (!currentTextContainer) {
                    currentTextContainer = assistantEl.createDiv('assistant-text-content');
                  }

                  // Schedule debounced render
                  scheduleRender();

                  lastWasToolUse = false;
                } else if (block.type === 'tool_use') {
                  // Force immediate render of pending text before tool
                  await performRender();

                  // Track tool use and create component
                  const toolId = block.id || `tool_${Date.now()}_${Math.random()}`;
                  if (!this.currentToolUses.has(toolId)) {
                    const toolData: ToolUseData = {
                      id: toolId,
                      name: block.name,
                      input: block.input,
                      isExpanded: false,
                    };

                    // Capture file state before Write/Edit operations
                    if (block.name === 'Write' || block.name === 'Edit') {
                      const filePath = block.input?.file_path;
                      if (filePath) {
                        try {
                          // Try to read current file content
                          const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                          if (file instanceof TFile) {
                            toolData.fileStateBefore = await this.plugin.app.vault.read(file);
                          } else {
                            // File doesn't exist yet (new file)
                            toolData.fileStateBefore = null;
                          }
                        } catch (error) {
                          console.log('[ObsidianAgent] Could not read file before change:', error);
                          toolData.fileStateBefore = null;
                        }
                      }
                    }

                    this.currentToolUses.set(toolId, toolData);

                    // Append tool component
                    const toolElement = this.createToolUseElement(toolData);
                    assistantEl.appendChild(toolElement);

                    // Next text will go in a new container with fresh text
                    currentTextContainer = null;
                    currentSectionText = '';
                  }
                  lastWasToolUse = true;
                }
              }

              // Show thinking indicator after tool use (agent is processing results)
              if (lastWasToolUse && loadingEl.isConnected) {
                loadingEl.style.display = '';
                // Wait for layout to update before scrolling
                requestAnimationFrame(() => {
                  messagesContainer.scrollTop = messagesContainer.scrollHeight;
                });
              } else {
                // Scroll to bottom after rendering
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
            }
          }

          // Handle tool results (may come as user messages with tool_result blocks)
          if (event.type === 'user' && event.message?.content && Array.isArray(event.message.content)) {
            for (const block of event.message.content) {
              if (block.type === 'tool_result') {
                const toolId = block.tool_use_id;
                const toolData = this.currentToolUses.get(toolId);

                if (toolData) {
                  // Update tool data with result
                  toolData.result = block.content;

                  // For Write/Edit operations, capture after state and generate diff
                  if ((toolData.name === 'Write' || toolData.name === 'Edit') && toolData.fileStateBefore !== undefined) {
                    const filePath = toolData.input?.file_path;
                    if (filePath) {
                      try {
                        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                        if (file instanceof TFile) {
                          const fileStateAfter = await this.plugin.app.vault.read(file);

                          // Generate and store diff
                          const fileChange = this.changeTracker.recordChange(
                            filePath,
                            toolData.name === 'Write' ? 'write' : 'edit',
                            toolData.fileStateBefore,
                            fileStateAfter
                          );
                          toolData.fileChange = fileChange;

                          console.log('[ObsidianAgent] Generated diff for:', filePath);
                        }
                      } catch (error) {
                        console.error('[ObsidianAgent] Could not generate diff:', error);
                      }
                    }
                  }

                  // Re-create the tool element with the result
                  if (toolData.element) {
                    const newElement = this.createToolUseElement(toolData);
                    toolData.element.replaceWith(newElement);
                  }

                  console.log('[ObsidianAgent] Updated tool result for:', toolData.name);
                }
              }
            }
          }
        }

        // Force final render of any pending text
        await performRender();

        // Remove loading indicator when completely done
        if (loadingEl.isConnected) {
          loadingEl.remove();
        }

        console.log('[ObsidianAgent] Query completed successfully');
        this.messages.push({ role: 'assistant', content: fullResponse });
      } catch (error: any) {
        console.error('[ObsidianAgent] Query error:', error);
        console.error('[ObsidianAgent] Error stack:', error.stack);
        loadingEl.remove();

        // Check if it was aborted
        if (error.name === 'AbortError' || this.abortController?.signal.aborted) {
          this.addMessage(messagesContainer, 'assistant', '*Stopped by user*');
        } else {
          const errorMessage = `Error: ${error.message}\n\nCheck browser console (F12) for details.`;
          new Notice(errorMessage);
          this.addMessage(messagesContainer, 'assistant', errorMessage);
        }
      } finally {
        this.isLoading = false;
        this.abortController = null;
        sendButton.style.display = '';
        stopButton.style.display = 'none';
        textarea.focus();
      }
    };

    stopButton.addEventListener('click', () => {
      if (this.abortController) {
        console.log('[ObsidianAgent] Aborting query...');
        this.abortController.abort();
      }
    });

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

  fixOverflowOnElement(element: HTMLElement) {
    // Remove overflow constraints from the element and all its children
    element.style.overflow = 'visible';
    element.style.maxHeight = 'none';

    // Fix all child divs that might have overflow constraints
    const allDivs = element.querySelectorAll('div');
    allDivs.forEach((div: HTMLElement) => {
      div.style.overflow = 'visible';
      div.style.maxHeight = 'none';
    });
  }

  async revertChange(fileChange: FileChange): Promise<void> {
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(fileChange.filePath);

      if (fileChange.oldContent === null) {
        // File was newly created, delete it
        if (file instanceof TFile) {
          await this.plugin.app.vault.delete(file);
          new Notice(`Reverted: Deleted ${fileChange.filePath}`);
          console.log('[ObsidianAgent] Reverted file creation:', fileChange.filePath);
        }
      } else {
        // File was modified, restore old content
        if (file instanceof TFile) {
          await this.plugin.app.vault.modify(file, fileChange.oldContent);
          new Notice(`Reverted changes to ${fileChange.filePath}`);
          console.log('[ObsidianAgent] Reverted file modification:', fileChange.filePath);
        } else {
          // File was deleted after being modified, recreate it
          await this.plugin.app.vault.create(fileChange.filePath, fileChange.oldContent);
          new Notice(`Reverted: Restored ${fileChange.filePath}`);
          console.log('[ObsidianAgent] Reverted file deletion:', fileChange.filePath);
        }
      }

      // Clear the change from tracker
      this.changeTracker.clearChange(fileChange.id);
    } catch (error: any) {
      console.error('[ObsidianAgent] Error reverting change:', error);
      new Notice(`Error reverting change: ${error.message}`);
    }
  }

  createToolUseElement(toolData: ToolUseData): HTMLElement {
    const container = document.createElement('div');
    container.className = 'tool-use-container';

    // Create header (clickable)
    const header = document.createElement('div');
    header.className = 'tool-use-header';

    const chevron = document.createElement('span');
    chevron.className = 'tool-use-chevron';
    chevron.textContent = '▶';

    const toolName = document.createElement('span');
    toolName.className = 'tool-use-name';
    toolName.textContent = ` 🔧 ${toolData.name}`;

    header.appendChild(chevron);
    header.appendChild(toolName);

    // Create collapsible content
    const content = document.createElement('div');
    content.className = 'tool-use-content';
    content.style.display = 'none';

    // Parameters section
    const paramsSection = document.createElement('div');
    paramsSection.className = 'tool-use-section';

    const paramsLabel = document.createElement('div');
    paramsLabel.className = 'tool-use-section-label';
    paramsLabel.textContent = 'Parameters:';

    const paramsValue = document.createElement('pre');
    paramsValue.className = 'tool-use-json';
    paramsValue.textContent = JSON.stringify(toolData.input, null, 2);

    paramsSection.appendChild(paramsLabel);
    paramsSection.appendChild(paramsValue);
    content.appendChild(paramsSection);

    // Results section (if available)
    if (toolData.result !== undefined) {
      const resultsSection = document.createElement('div');
      resultsSection.className = 'tool-use-section';

      const resultsLabel = document.createElement('div');
      resultsLabel.className = 'tool-use-section-label';
      resultsLabel.textContent = 'Result:';

      const resultsValue = document.createElement('pre');
      resultsValue.className = 'tool-use-json';

      // Format result based on type
      if (typeof toolData.result === 'string') {
        resultsValue.textContent = toolData.result;
      } else {
        resultsValue.textContent = JSON.stringify(toolData.result, null, 2);
      }

      resultsSection.appendChild(resultsLabel);
      resultsSection.appendChild(resultsValue);
      content.appendChild(resultsSection);
    }

    // Diff section (if available for Write/Edit operations)
    if (toolData.fileChange) {
      const diffSection = document.createElement('div');
      diffSection.className = 'tool-use-section';

      const diffHeader = document.createElement('div');
      diffHeader.style.display = 'flex';
      diffHeader.style.justifyContent = 'space-between';
      diffHeader.style.alignItems = 'center';
      diffHeader.style.marginBottom = '4px';

      const diffLabel = document.createElement('div');
      diffLabel.className = 'tool-use-section-label';
      diffLabel.textContent = 'Changes:';

      const revertButton = document.createElement('button');
      revertButton.className = 'tool-use-revert-button';
      revertButton.textContent = '↶ Revert';
      revertButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.revertChange(toolData.fileChange!);
        revertButton.disabled = true;
        revertButton.textContent = '✓ Reverted';
      });

      diffHeader.appendChild(diffLabel);
      diffHeader.appendChild(revertButton);

      const diffValue = document.createElement('pre');
      diffValue.className = 'tool-use-diff';
      diffValue.textContent = toolData.fileChange.diff;

      diffSection.appendChild(diffHeader);
      diffSection.appendChild(diffValue);
      content.appendChild(diffSection);
    }

    // Click handler for expand/collapse
    header.addEventListener('click', () => {
      toolData.isExpanded = !toolData.isExpanded;

      if (toolData.isExpanded) {
        content.style.display = 'block';
        chevron.textContent = '▼';
      } else {
        content.style.display = 'none';
        chevron.textContent = '▶';
      }
    });

    container.appendChild(header);
    container.appendChild(content);

    // Store reference to element
    toolData.element = container;

    return container;
  }

  async addMessage(container: HTMLElement, role: 'user' | 'assistant', content: string) {
    const messageEl = container.createDiv(`agent-message ${role}`);

    if (role === 'assistant') {
      // Render markdown for assistant messages
      await MarkdownRenderer.renderMarkdown(content, messageEl, '/', this);

      // Fix overflow after rendering
      this.fixOverflowOnElement(messageEl);

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
        padding: 16px;
        background: var(--background-primary);
      }

      .agent-messages {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 4px;
        padding-bottom: 8px;
      }

      .agent-messages::-webkit-scrollbar {
        width: 8px;
      }

      .agent-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .agent-messages::-webkit-scrollbar-thumb {
        background: var(--background-modifier-border);
        border-radius: 4px;
      }

      .agent-messages::-webkit-scrollbar-thumb:hover {
        background: var(--background-modifier-border-hover);
      }

      .agent-message {
        padding: 12px 16px;
        border-radius: 12px;
        max-width: 80%;
        overflow-wrap: break-word;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        animation: slideIn 0.2s ease-out;
        overflow: visible !important;
        max-height: none !important;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .agent-message.user {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        align-self: flex-end;
        word-wrap: break-word;
        overflow-wrap: break-word;
        word-break: break-word;
        overflow-x: auto;
        border-bottom-right-radius: 4px;
      }

      .agent-message.user * {
        user-select: text;
        cursor: text;
      }

      .agent-message.assistant {
        background: var(--background-secondary);
        align-self: flex-start;
        word-wrap: break-word;
        overflow-wrap: break-word;
        word-break: break-word;
        overflow-x: auto;
        border-bottom-left-radius: 4px;
        border: 1px solid var(--background-modifier-border);
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
        margin-bottom: 0.08em;
        line-height: 1.4;
      }

      .agent-message.assistant p:first-child {
        margin-top: 0;
      }

      .agent-message.assistant p:last-child {
        margin-bottom: 0;
      }

      /* Collapse empty paragraphs */
      .agent-message.assistant p:empty {
        display: none;
      }

      /* Tool indicators - small paragraph with moderate spacing */
      .agent-message.assistant p:has(em:first-child) {
        margin-bottom: 0.25em;
        font-size: 0.95em;
        opacity: 0.85;
      }

      .agent-message.assistant p em {
        display: inline;
        margin: 0;
        padding: 0;
      }

      .agent-message.assistant ul,
      .agent-message.assistant ol {
        margin: 0;
        margin-bottom: 0.1em;
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
        margin-top: 0.3em;
        margin-bottom: 0.1em;
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
        word-break: break-all;
        white-space: pre-wrap;
      }

      .agent-message.assistant pre {
        margin: 0;
        margin-bottom: 0.15em;
        overflow-x: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        max-width: 100%;
      }

      .agent-message.assistant pre:last-child {
        margin-bottom: 0;
      }

      /* Obsidian markdown wrapper divs - remove extra spacing */
      .agent-message.assistant .markdown-preview-section,
      .agent-message.assistant .markdown-preview-view {
        margin: 0;
        padding: 0;
        max-height: none !important;
        overflow: visible !important;
        height: auto !important;
      }

      /* Ensure markdown containers don't create scrollable areas */
      .agent-message.assistant .markdown-preview-sizer {
        max-height: none !important;
        overflow: visible !important;
      }

      /* Catch-all for any container divs that might be created */
      .agent-message.assistant > div,
      .agent-message.assistant div[class*="markdown"],
      .agent-message.assistant div[class*="preview"] {
        max-height: none !important;
        overflow: visible !important;
      }

      @keyframes pulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }

      .agent-message.loading {
        font-style: italic;
        animation: pulse 1.5s ease-in-out infinite;
      }

      .agent-message.loading::after {
        content: '...';
        animation: ellipsis 1.5s steps(4, end) infinite;
      }

      @keyframes ellipsis {
        0% { content: ''; }
        25% { content: '.'; }
        50% { content: '..'; }
        75% { content: '...'; }
      }

      .tool-call {
        font-size: 0.9em;
        opacity: 0.7;
        margin-top: 4px;
      }

      /* Tool use expandable components */
      .tool-use-container {
        margin: 8px 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        overflow: hidden;
      }

      .tool-use-header {
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        gap: 4px;
        background: var(--background-primary-alt);
        transition: background 0.2s;
      }

      .tool-use-header:hover {
        background: var(--background-modifier-hover);
      }

      .tool-use-chevron {
        display: inline-block;
        transition: transform 0.2s;
        font-size: 0.8em;
        width: 12px;
      }

      .tool-use-name {
        font-size: 0.9em;
        font-weight: 500;
      }

      .tool-use-content {
        padding: 12px;
        border-top: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
      }

      .tool-use-section {
        margin-bottom: 12px;
      }

      .tool-use-section:last-child {
        margin-bottom: 0;
      }

      .tool-use-section-label {
        font-size: 0.85em;
        font-weight: 600;
        color: var(--text-muted);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .tool-use-json {
        margin: 0;
        padding: 8px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        font-family: var(--font-monospace);
        font-size: 0.85em;
        line-height: 1.5;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--text-normal);
      }

      .agent-input-container {
        display: flex;
        gap: 8px;
        padding: 12px;
        background: var(--background-secondary);
        border-radius: 12px;
        border: 1px solid var(--background-modifier-border);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
      }

      .agent-textarea-wrapper {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .agent-input {
        width: 100%;
        min-height: 60px;
        max-height: 200px;
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        resize: vertical;
        font-family: var(--font-text);
        font-size: var(--font-ui-medium);
        transition: border-color 0.2s;
      }

      .agent-input:focus {
        outline: none;
        border-color: var(--interactive-accent);
      }

      .agent-button-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .agent-file-indicator {
        font-size: 0.85em;
        color: var(--text-muted);
        padding: 4px 8px;
        background: var(--background-primary);
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
      }

      .agent-send-button,
      .agent-stop-button,
      .agent-clear-button,
      .agent-upload-button {
        padding: 10px 20px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-weight: 500;
        font-size: var(--font-ui-small);
        transition: all 0.2s;
        white-space: nowrap;
      }

      .agent-send-button {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      .agent-send-button:hover {
        background: var(--interactive-accent-hover);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .agent-send-button:active {
        transform: translateY(0);
      }

      .agent-stop-button {
        background: var(--color-red);
        color: white;
      }

      .agent-stop-button:hover {
        background: var(--color-red);
        opacity: 0.9;
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(255, 0, 0, 0.2);
      }

      .agent-clear-button {
        background: var(--background-modifier-border);
        color: var(--text-normal);
      }

      .agent-clear-button:hover {
        background: var(--background-modifier-border-hover);
        transform: translateY(-1px);
      }

      .agent-upload-button {
        background: var(--background-secondary);
        color: var(--text-normal);
        font-size: 16px;
      }

      .agent-upload-button:hover {
        background: var(--background-secondary-alt);
        transform: translateY(-1px);
      }

      /* Diff styling */
      .tool-use-diff {
        margin: 0;
        padding: 12px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        font-family: var(--font-monospace);
        font-size: 0.8em;
        line-height: 1.5;
        overflow-x: auto;
        white-space: pre;
        color: var(--text-normal);
      }

      .tool-use-diff::before {
        content: '';
        display: block;
        margin-bottom: 8px;
      }

      /* Revert button */
      .tool-use-revert-button {
        padding: 4px 12px;
        border-radius: 4px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        cursor: pointer;
        font-size: 0.85em;
        font-weight: 500;
        transition: all 0.2s;
      }

      .tool-use-revert-button:hover {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
      }

      .tool-use-revert-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: var(--background-modifier-success);
        color: var(--text-on-accent);
        border-color: var(--background-modifier-success);
      }

      .tool-use-revert-button:disabled:hover {
        background: var(--background-modifier-success);
        border-color: var(--background-modifier-success);
      }
    `;
    document.head.appendChild(style);
  }

  async onClose() {
    // Clean up
  }
}
