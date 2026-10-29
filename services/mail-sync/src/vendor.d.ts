// Packages from the JSON Resume project ship without type declarations (ADR 0018).
declare module '@jsonresume/schema' {
  const schema: { validate(resume: unknown, done: (errors: { stack?: string; message?: string }[] | null, valid: boolean) => void): void; schema: object };
  export default schema;
}
declare module '@jsonresume/jsonresume-to-rendercv/convert.js' {
  export function convert(resume: unknown): Promise<string>;
}
