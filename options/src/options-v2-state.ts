export type OptionsSectionId = 'panel' | 'connection' | 'projects' | 'audio' | 'auto-reflect' | 'data';
const SECTIONS: readonly OptionsSectionId[] = ['panel', 'connection', 'projects', 'audio', 'auto-reflect', 'data'];

export function getOptionsSectionFromHash(hash: string): OptionsSectionId {
  const candidate = hash.replace(/^#/u, '') as OptionsSectionId;
  return SECTIONS.includes(candidate) ? candidate : 'panel';
}

export function getEditorGroupFallback<T extends Readonly<{ id: string }>>(
  selectedId: string,
  groups: readonly T[],
): string {
  return groups.some(({ id }) => id === selectedId) ? selectedId : groups[0]?.id ?? 'always';
}
