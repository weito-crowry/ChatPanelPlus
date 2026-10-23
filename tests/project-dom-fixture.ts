type Attributes = Record<string, string>;

export const PROJECT_ALPHA_ID = 'g-p-0123456789abcdef0123456789abcdef';
export const PROJECT_BETA_ID = 'g-p-fedcba9876543210fedcba9876543210';
export const PROJECT_GAMMA_ID = 'g-p-11223344556677889900aabbccddeeff';
export const PROJECT_DELTA_ID = 'g-p-aabbccddeeff00112233445566778899';

export class FakeProjectElement {
  readonly tagName: string;
  readonly attributes: Attributes;
  readonly children: FakeProjectElement[] = [];
  parentElement: FakeProjectElement | null = null;
  visible = true;
  private readonly text: string;

  constructor(tagName: string, attributes: Attributes = {}, text = '') {
    this.tagName = tagName.toLowerCase();
    this.attributes = { ...attributes };
    this.text = text;
  }

  append(...children: FakeProjectElement[]): this {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  get innerText(): string {
    return [this.text, ...this.children.map((child) => child.innerText)].filter(Boolean).join(' ');
  }

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  getClientRects(): readonly unknown[] { return this.visible ? [{}] : []; }
  checkVisibility(): boolean { return this.visible; }

  closest(selector: string): FakeProjectElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(element: FakeProjectElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  querySelectorAll(selector: string): FakeProjectElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector: string): FakeProjectElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const item = part.trim();
      const tagAndAttribute = /^([a-z]+)?\[([^\]]+)\]$/iu.exec(item);
      if (tagAndAttribute) {
        const [, tag, attribute] = tagAndAttribute;
        return (!tag || this.tagName === tag.toLowerCase()) && attribute !== undefined && this.hasAttribute(attribute);
      }
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/u.exec(item);
      if (attribute) return attribute[2] === undefined
        ? this.hasAttribute(attribute[1]!)
        : this.getAttribute(attribute[1]!) === attribute[2];
      return this.tagName === item.toLowerCase();
    });
  }
}

export class FakeProjectDocument {
  readonly documentElement = new FakeProjectElement('html');
  readonly body = new FakeProjectElement('body');
  readonly main: FakeProjectElement | null;

  constructor(main: FakeProjectElement | null = new FakeProjectElement('main')) {
    this.main = main;
    this.documentElement.append(this.body);
    if (main) this.body.append(main);
  }

  querySelector(selector: string): FakeProjectElement | null {
    if (selector === 'main') return this.main;
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeProjectElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

export function projectLink(id: string, name: string): FakeProjectElement {
  return new FakeProjectElement('a', { href: `https://chatgpt.com/g/${id}/project` }, name);
}

export function projectConversationLink(
  id: string,
  chatId: string,
  name: string,
  current = false,
  slug?: string,
): FakeProjectElement {
  const projectSegment = slug ? `${id}-${slug}` : id;
  return new FakeProjectElement('a', {
    href: `https://chatgpt.com/g/${projectSegment}/c/${chatId}`,
    ...(current ? { 'aria-current': 'page' } : {}),
  }, name);
}
