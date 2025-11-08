import * as Diff from 'diff';

export interface FileChange {
	id: string;
	timestamp: number;
	filePath: string;
	operation: 'write' | 'edit';
	oldContent: string | null;
	newContent: string;
	diff: string;
}

export class ChangeTracker {
	private changes: Map<string, FileChange> = new Map();

	recordChange(
		filePath: string,
		operation: 'write' | 'edit',
		oldContent: string | null,
		newContent: string
	): FileChange {
		const id = `${Date.now()}_${filePath}`;
		const diff = this.generateDiff(oldContent || '', newContent, filePath);

		const change: FileChange = {
			id,
			timestamp: Date.now(),
			filePath,
			operation,
			oldContent,
			newContent,
			diff
		};

		this.changes.set(id, change);
		return change;
	}

	getChange(id: string): FileChange | undefined {
		return this.changes.get(id);
	}

	clearChange(id: string): void {
		this.changes.delete(id);
	}

	private generateDiff(oldContent: string, newContent: string, fileName: string): string {
		// Generate unified diff
		const patch = Diff.createPatch(fileName, oldContent, newContent, '', '');

		// Remove the header lines (first 4 lines) to get just the diff content
		const lines = patch.split('\n');
		const diffLines = lines.slice(4).join('\n');

		return diffLines;
	}

	generateFormattedDiff(oldContent: string, newContent: string): string {
		const changes = Diff.diffLines(oldContent, newContent);
		let formattedDiff = '';

		for (const change of changes) {
			const lines = change.value.split('\n').filter(line => line.length > 0);

			if (change.added) {
				for (const line of lines) {
					formattedDiff += `+ ${line}\n`;
				}
			} else if (change.removed) {
				for (const line of lines) {
					formattedDiff += `- ${line}\n`;
				}
			} else {
				for (const line of lines) {
					formattedDiff += `  ${line}\n`;
				}
			}
		}

		return formattedDiff;
	}
}
