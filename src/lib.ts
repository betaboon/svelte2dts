/* eslint-disable @typescript-eslint/unbound-method */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import sv2tsx from 'svelte2tsx'
import { relativePath ,relPathJson } from './utils'

interface TsxMapping {
  code: string
  dest: string
  componentPath: string
  dtsCode?: string
  autoGenerated?: boolean
}
type TsxMap = Record<string ,TsxMapping>

function generateTsx(srcPath:string) {
  const file = fs.readFileSync(srcPath)
  // Generate the tsx code for the component
  const { code: tsxCode } = sv2tsx(file.toString('utf-8') ,{
    filename: srcPath
    ,isTsFile: true
    // strictMode: true
  })

  const shimmedCode = '/// <reference types="svelte2tsx/svelte-shims" />\n'
  + '/// <reference types="svelte2tsx/svelte-jsx" />\n'
  + `${tsxCode}`

  return shimmedCode
}

function shouldCreateVirtual(componentPath: string) {
  // Only create declarations if a conflicting typing file does not exist.
  let typedPath = `${componentPath}.ts`
  if (fs.existsSync(typedPath)) {
    throw new Error(`Ts file ${relPathJson(typedPath)} conflicts with ${relPathJson(componentPath)}.`)
  }

  typedPath = `${componentPath}.tsx`
  if (fs.existsSync(typedPath)) {
    throw new Error(`Tsx file ${relPathJson(typedPath)} conflicts with ${relPathJson(componentPath)}.`)
  }

  typedPath = `${componentPath}.d.ts`
  if (fs.existsSync(typedPath)) return false

  // No typings exists. Safe to generate!
  return true
}

// Runs on multiple components at a time to reduce wasted cycles.
// shouldGenerateTypings = (filePath)=>filePath.endsWith('.svelte')
export function generateComponentDeclarations(componentPaths: string[]
  ,srcDir: string
  ,outDir: string
  ,shouldGenerateTypings: (filePath:string)=>boolean = () => false): TsxMap {
  const genTsxPath = (filePath:string) => `${filePath}.tsx`
  const genTsxMapping = (filePath: string) => ({
    code: generateTsx(filePath)
    ,dest: `${path.resolve(outDir)}${filePath.slice(path.resolve(srcDir).length)}.d.ts`
    ,componentPath: filePath
  } as TsxMapping)

  // Keep up with tsx->d.ts conversion paths
  const tsxMap: TsxMap = {}

  // Generate tsx files
  for (const compPath of componentPaths) {
    // eslint-disable-next-line no-continue
    if (!shouldCreateVirtual(compPath)) continue
    // Write to a tsx file. Required by ts createProgram
    const tsxOutPath = genTsxPath(compPath)
    tsxMap[tsxOutPath] = genTsxMapping(compPath)
  }

  // Generate d.ts files
  compileTsDeclaration(tsxMap ,{
    declaration: true
    ,emitDeclarationOnly: true
  } ,(filePath ,fileExists) => {
    // FIXME: This is contrived. Steal whatever code ts is using to loop fileExist instead
    // Only claim tsx files
    if (!filePath.endsWith('.tsx')) return

    const componentPath = filePath.replace(/\.tsx$/ ,'')
    // Only claim tsx files which refers to a file in the fs
    if (!fileExists(componentPath)) return

    // Only claim files we are interested in (like .svelte files)
    if (!shouldGenerateTypings(componentPath)) return

    if (!shouldCreateVirtual(componentPath)) return

    // Only claim files in src dir
    if (!filePath.startsWith(srcDir)) return

    // If we made it here, then we want to create a virtual file!
    tsxMap[filePath] = genTsxMapping(filePath.replace(/\.tsx$/ ,''))
    tsxMap[filePath].autoGenerated = true
  })
  return tsxMap
}

function compileTsDeclaration(files: TsxMap
  ,options: ts.CompilerOptions
  ,autoVirtual: (filePath:string
    ,fileExist: ts.CompilerHost['fileExists'])=>void = () => {}) {
  // Create a Program with an in-memory emit
  const host = ts.createCompilerHost(options)
  host.writeFile = (fileName ,contents) => {
    const file = Object.values(files).find((e) => e.componentPath === fileName.replace(/\.d\.ts/ ,''))
    if (file !== undefined) {
      file.dtsCode = contents
    }
  }
  const originalReadFile = host.readFile
  const originalFileExists = host.fileExists
  host.fileExists = (filePath) => {
    // Attempt to auto-create virtuals
    if (files[filePath] === undefined) {
      autoVirtual(filePath ,(somePath) => originalFileExists.call(host ,somePath))
    }
    // Logging
    // const asVirtual = files[filePath]?.code !== undefined
    // if (!filePath.includes('node_modules')) console.log('Checking existence of...',relativePath(filePath), asVirtual ? 'virtual' : originalFileExists.call(host,filePath))

    return files[filePath] !== undefined || originalFileExists.call(host ,filePath)
  }
  host.readFile = (filePath) =>
    // const asVirtual = files[filePath]?.code !== undefined
    // if (!filePath.includes('node_modules')) console.log(`Reading${asVirtual ? ' (virtual)' : ''}...`,relativePath(filePath))
    files[filePath]?.code ?? originalReadFile.call(host ,filePath)

  // Prepare the contents for the d.ts files
  let runs = 1
  const maxAttempts = 5
  while (runs === 1 || (
    Object.values(files).some((e) => e.autoGenerated) && runs <= maxAttempts
  )) {
    const targetFiles = runs === 1 ? Object.keys(files) : Object.entries(files)
      .filter(([,e]) => e.autoGenerated)
      .map(([k]) => k)
    console.log(`--- ${runs > 1 ? 'Re-' : ''}Running TS (attempt: ${runs}) ---`)
    if (runs > 1) {
      console.log('Covering missed files'
        ,Object.values(files)
          .filter((e) => e.autoGenerated)
          .map((e) => relativePath(e.componentPath)))
    }
    // Un-mark any auto generated files
    Object.values(files).forEach((e) => {
      if (e.autoGenerated === true) e.autoGenerated = false
    })

    // Run ts
    // FIXME: There is a better way to loop this.
    // Maybe using .emit(fileName), or possible using languageServices.
    const program = ts.createProgram(targetFiles ,options ,host)
    const sourceFiles = program.getSourceFiles()
    for (const sourceFile of sourceFiles) {
      if (!Object.keys(files).includes(sourceFile.fileName)) continue
      ts.forEachChild(sourceFile ,(node) => {
        if (ts.isClassDeclaration(node)
        && node.modifiers?.some((e) => e.kind === ts.SyntaxKind.ExportKeyword) === true
        && node.modifiers?.some((e) => e.kind === ts.SyntaxKind.DefaultKeyword) === true
        ) {
          console.log('Got Type:' ,node.heritageClauses?.[0].types[0].getFullText())
        }
      })
    }
    program.emit()

    // Increment run counter
    runs++
  }
}
/*
function visit(node: ts.Node) {
  // Only consider exported nodes
  if (!node) {
    return
  }

  if (ts.isClassDeclaration(node) && node.name) {
    // This is a top level class, get its symbol
    const symbol = checker.getSymbolAtLocation(node.name)
    if (symbol) {
      output.push(serializeClass(symbol))
    }
    // No need to walk any further, class expressions/inner declarations
    // cannot be exported
  }
  else if (ts.isModuleDeclaration(node)) {
    // This is a namespace, visit its children
    ts.forEachChild(node ,visit)
  }
}
*/
