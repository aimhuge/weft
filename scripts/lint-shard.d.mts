export function lintableFiles(tracked: string[]): string[];
export function shardOf(file: string, count: number): number;
export function shardFiles(files: string[], index: number, count: number): string[];
export function partitionProblems(files: string[], count: number): string[];
