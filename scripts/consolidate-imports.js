#!/usr/bin/env node
/**
 * Import consolidation script for Deepkit → 0x7B restructuring
 * Consolidates multiple imports from the same package into single statements
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

// Statistics
let filesScanned = 0;
let filesModified = 0;
let importsConsolidated = 0;

/**
 * Recursively find all TypeScript files
 */
function findTypeScriptFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        findTypeScriptFiles(fullPath, files);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Consolidate imports in a single file
 */
function consolidateImportsInFile(filePath) {
  filesScanned++;
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Find all import statements and group by package
  const lines = content.split('\n');
  const importMap = new Map(); // package -> { imports: Set, lines: [] }
  const nonImportLines = [];
  let inImportSection = false;
  let importSectionStart = -1;
  let importSectionEnd = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Match: import { X, Y } from '@7b/...'
    // Match: import * as X from '@7b/...'
    // Match: import X from '@7b/...'
    const importMatch = trimmed.match(/^import\s+(?:{\s*([^}]+)\s*}|(\*\s+as\s+\w+)|\w+)\s+from\s+['"](@7b\/[^'"]+)['"]/);
    
    if (importMatch) {
      if (importSectionStart === -1) {
        importSectionStart = i;
      }
      importSectionEnd = i;
      inImportSection = true;
      
      const packageName = importMatch[3];
      const imports = importMatch[1] || importMatch[2] || '';
      
      if (!importMap.has(packageName)) {
        importMap.set(packageName, {
          imports: new Set(),
          hasNamespace: false,
          hasDefault: false,
          lines: []
        });
      }
      
      const pkgData = importMap.get(packageName);
      pkgData.lines.push(i);
      
      if (importMatch[2]) {
        // namespace import: import * as X
        pkgData.hasNamespace = true;
        pkgData.imports.add(imports);
      } else if (imports) {
        // named imports
        imports.split(',').forEach(imp => {
          const cleaned = imp.trim();
          if (cleaned) {
            pkgData.imports.add(cleaned);
          }
        });
      }
    } else if (trimmed.startsWith('import ')) {
      // Other import (not @7b)
      nonImportLines.push({ index: i, line });
    } else {
      if (inImportSection && trimmed !== '') {
        // End of import section
        inImportSection = false;
      }
      nonImportLines.push({ index: i, line });
    }
  }
  
  // Check if consolidation is needed
  let needsConsolidation = false;
  for (const [pkg, data] of importMap.entries()) {
    if (data.lines.length > 1 && !data.hasNamespace) {
      needsConsolidation = true;
      break;
    }
  }
  
  if (!needsConsolidation) {
    return;
  }
  
  // Rebuild the file with consolidated imports
  const newLines = [];
  let lineIndex = 0;
  
  // Add lines before import section
  while (lineIndex < importSectionStart) {
    newLines.push(lines[lineIndex]);
    lineIndex++;
  }
  
  // Add consolidated imports
  const consolidatedPackages = Array.from(importMap.entries())
    .filter(([_, data]) => data.lines.length > 1 && !data.hasNamespace)
    .map(([pkg]) => pkg);
  
  for (const [pkg, data] of importMap.entries()) {
    if (data.hasNamespace) {
      // Keep namespace imports as-is
      for (const lineNum of data.lines) {
        newLines.push(lines[lineNum]);
      }
    } else if (data.lines.length > 1) {
      // Consolidate multiple imports
      const sortedImports = Array.from(data.imports).sort();
      newLines.push(`import { ${sortedImports.join(', ')} } from '${pkg}';`);
      importsConsolidated += data.lines.length - 1;
    } else {
      // Single import, keep as-is
      newLines.push(lines[data.lines[0]]);
    }
  }
  
  // Skip old import section
  lineIndex = importSectionEnd + 1;
  
  // Add remaining lines
  while (lineIndex < lines.length) {
    newLines.push(lines[lineIndex]);
    lineIndex++;
  }
  
  const newContent = newLines.join('\n');
  
  if (newContent !== originalContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    filesModified++;
    
    if (consolidatedPackages.length > 0) {
      console.log(`  ✓ ${path.relative(ROOT_DIR, filePath)} (${consolidatedPackages.length} packages consolidated)`);
    }
  }
}

/**
 * Main execution
 */
function main() {
  console.log('==================================================');
  console.log('Deepkit → 0x7B: Import Consolidation');
  console.log('==================================================\n');
  
  console.log('Scanning for TypeScript files...');
  const files = findTypeScriptFiles(PACKAGES_DIR);
  console.log(`Found ${files.length} TypeScript files\n`);
  
  console.log('Consolidating imports...');
  for (const file of files) {
    try {
      consolidateImportsInFile(file);
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
  
  console.log('\n==================================================');
  console.log('Import Consolidation Complete!');
  console.log('==================================================');
  console.log(`Files scanned:        ${filesScanned}`);
  console.log(`Files modified:       ${filesModified}`);
  console.log(`Imports consolidated: ${importsConsolidated}`);
  console.log('==================================================\n');
  
  if (filesModified === 0) {
    console.log('ℹ️  No files were modified - imports already consolidated\n');
  } else {
    console.log('✅ Imports have been consolidated!');
    console.log('Example:');
    console.log('  Before:');
    console.log('    import { eventDispatcher } from \'@7b/core\';');
    console.log('    import { Logger } from \'@7b/core\';');
    console.log('  After:');
    console.log('    import { eventDispatcher, Logger } from \'@7b/core\';\n');
  }
}

main();
