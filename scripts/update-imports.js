#!/usr/bin/env node
/**
 * Import statement updater for Deepkit → 0x7B restructuring
 * Updates all import statements from @deepkit/* to @7b/*
 */

const fs = require('fs');
const path = require('path');
const importMapping = require('./import-mapping.js');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

// Statistics
let filesScanned = 0;
let filesModified = 0;
let importsUpdated = 0;

/**
 * Recursively find all TypeScript files
 */
function findTypeScriptFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip node_modules and dist directories
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
 * Update imports in a single file
 */
function updateImportsInFile(filePath) {
  filesScanned++;
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let fileImportsUpdated = 0;
  
  // Update each import mapping
  for (const [oldPkg, newPkg] of Object.entries(importMapping)) {
    // Match import/export statements with this package
    // Handles: import { X } from '@deepkit/core'
    //         import * as X from '@deepkit/core'
    //         export { X } from '@deepkit/core'
    //         export * from '@deepkit/core'
    const patterns = [
      new RegExp(`from ['"]${oldPkg.replace(/\//g, '\\/')}['"]`, 'g'),
      new RegExp(`require\\(['"]${oldPkg.replace(/\//g, '\\/')}['"]\\)`, 'g'),
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        fileImportsUpdated += matches.length;
        content = content.replace(pattern, (match) => {
          return match.replace(oldPkg, newPkg);
        });
      }
    }
  }
  
  // Only write if content changed
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    filesModified++;
    importsUpdated += fileImportsUpdated;
    
    // Show progress for files with many changes
    if (fileImportsUpdated > 5) {
      console.log(`  ✓ ${path.relative(ROOT_DIR, filePath)} (${fileImportsUpdated} imports)`);
    }
  }
}

/**
 * Main execution
 */
function main() {
  console.log('==================================================');
  console.log('Deepkit → 0x7B: Import Statement Updater');
  console.log('==================================================\n');
  
  // Find all TypeScript files in packages directory
  console.log('Scanning for TypeScript files...');
  const files = findTypeScriptFiles(PACKAGES_DIR);
  console.log(`Found ${files.length} TypeScript files\n`);
  
  // Update imports in each file
  console.log('Updating import statements...');
  for (const file of files) {
    updateImportsInFile(file);
  }
  
  console.log('\n==================================================');
  console.log('Import Update Complete!');
  console.log('==================================================');
  console.log(`Files scanned:   ${filesScanned}`);
  console.log(`Files modified:  ${filesModified}`);
  console.log(`Imports updated: ${importsUpdated}`);
  console.log('==================================================\n');
  
  if (filesModified === 0) {
    console.log('ℹ️  No files were modified. This may mean:');
    console.log('   - Imports have already been updated');
    console.log('   - The mapping needs adjustment');
    console.log('   - Files are in a different location\n');
  } else {
    console.log('✅ Import statements have been updated!');
    console.log('Next steps:');
    console.log('   1. Review the changes with: git diff');
    console.log('   2. Test the build: npm run build');
    console.log('   3. Run tests: npm test');
    console.log('   4. Commit the changes\n');
  }
}

// Run the script
main();
