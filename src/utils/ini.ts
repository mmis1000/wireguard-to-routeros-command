
interface IniOptions<ArraySectionName extends string = never> {
  arraySections?: ArraySectionName[]
}
const isSectionHeader = (str: string) => {
  return /^\[.+\]$/.test(str)
}
const isComment = (str: string) => {
  return /^#/.test(str)
}
export const parseIni = <ArraySectionName extends string = never>(str: string, opts?: IniOptions<ArraySectionName>) => {
  const arraySections = opts?.arraySections ?? []
  const lines = str.split(/\r?\n/g).filter(i => !/^\s*$/.test(i))

  const result: Record<string, any> = {}
  let currentSection = ''
  for (const line of lines) {
    if (isComment(line)) {
      // do nothing
    } else if (isSectionHeader(line)) {
      const isArraySection = arraySections.includes(currentSection as any)
      if (isArraySection) {
        const nextSection = line.slice(1, -1)
        result[nextSection] = result[nextSection] ?? []
        result[nextSection].push({})
        currentSection = nextSection
      } else {
        currentSection = line.slice(1, -1)
      }
    } else {
      const isArraySection = arraySections.includes(currentSection as any)
      if (isArraySection) {
        const targetEntry: Record<string, any>[] = result[currentSection] ?? []
        result[currentSection] = targetEntry

        let targetDict: Record<string, any>
        if (targetEntry.length > 0) {
          targetDict = targetEntry[targetEntry.length - 1]
        } else {
          targetDict = {}
          targetEntry.push(targetDict)
        }
        const [name, ...rest] = line.split(/=/)
        targetDict[name.trim()] = rest.join('=')?.trim() ?? null
      } else {
        const targetDict: Record<string, any> = result[currentSection] ?? {}
        result[currentSection] = targetDict
        const [name, ...rest] = line.split(/=/)
        targetDict[name.trim()] = rest.join('=')?.trim() ?? null
      }
    }
  }

  return result
}
