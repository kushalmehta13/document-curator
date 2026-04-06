export function templateVarKeys(pathTemplate: string): string[] {
  const keys: string[] = []
  const re = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pathTemplate)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1])
  }
  return keys
}
