#!/bin/bash
# Full-scale package restructuring automation script
# This script handles the mechanical work of consolidating 56 packages into 7

set -e

REPO_ROOT="/home/runner/work/deepkit/deepkit"
cd "$REPO_ROOT"

echo "=================================================="
echo "Deepkit → 0x7B Package Restructuring - Phase 1"
echo "=================================================="
echo ""
echo "Starting file consolidation..."
echo ""

# Create new package directories
mkdir -p packages/runtime/src
mkdir -p packages/reflection/src
mkdir -p packages/codec/src
mkdir -p packages/core-consolidated/src
mkdir -p packages/io/src
mkdir -p packages/db/src
mkdir -p packages/ui/src

# Function to copy package preserving structure
copy_package() {
    local src_pkg=$1
    local dest_pkg=$2
    local subdir=$3
    
    if [ -d "packages/$src_pkg" ]; then
        echo "  → $src_pkg"
        
        mkdir -p "packages/$dest_pkg/src/$subdir"
        
        # Copy source files
        if [ -d "packages/$src_pkg/src" ]; then
            cp -r "packages/$src_pkg/src/"* "packages/$dest_pkg/src/$subdir/"
        else
            cp packages/$src_pkg/*.ts "packages/$dest_pkg/src/$subdir/" 2>/dev/null || true
        fi
        
        # Copy tests
        if [ -d "packages/$src_pkg/tests" ]; then
            mkdir -p "packages/$dest_pkg/tests/$subdir"
            cp -r "packages/$src_pkg/tests/"* "packages/$dest_pkg/tests/$subdir/"
        fi
    fi
}

echo "[1/7] @7b/runtime..."
copy_package "core" "runtime" "core"
copy_package "bench" "runtime" "bench"
copy_package "run" "runtime" "run"
copy_package "bun" "runtime" "bun"

echo "[2/7] @7b/reflection..."
copy_package "type" "reflection" "type"
copy_package "type-compiler" "reflection" "compiler"
copy_package "type-spec" "reflection" "spec"

echo "[3/7] @7b/codec..."
copy_package "bson" "codec" "bson"

echo "[4/7] @7b/core..."
copy_package "app" "core-consolidated" "app"
copy_package "injector" "core-consolidated" "injector"
copy_package "logger" "core-consolidated" "logger"
copy_package "event" "core-consolidated" "event"
copy_package "stopwatch" "core-consolidated" "stopwatch"
copy_package "workflow" "core-consolidated" "workflow"
copy_package "template" "core-consolidated" "template"
copy_package "topsort" "core-consolidated" "topsort"

echo "[5/7] @7b/io..."
copy_package "http" "io" "http"
copy_package "rpc" "io" "rpc"
copy_package "rpc-tcp" "io" "rpc-tcp"
copy_package "broker" "io" "broker"
copy_package "broker-redis" "io" "broker-redis"
copy_package "core-rxjs" "io" "core-rxjs"
copy_package "filesystem" "io" "fs"
copy_package "filesystem-aws-s3" "io" "fs-aws-s3"
copy_package "filesystem-ftp" "io" "fs-ftp"
copy_package "filesystem-sftp" "io" "fs-sftp"
copy_package "filesystem-google" "io" "fs-google"
copy_package "filesystem-database" "io" "fs-database"

echo "[6/7] @7b/db..."
copy_package "orm" "db" "orm"
copy_package "sql" "db" "sql"
copy_package "postgres" "db" "postgres"
copy_package "mysql" "db" "mysql"
copy_package "sqlite" "db" "sqlite"
copy_package "mongo" "db" "mongo"
copy_package "orm-integration" "db" "orm-integration"

echo "[7/7] @7b/ui..."
copy_package "ui-library" "ui" "library"
copy_package "type-angular" "ui" "type-angular"
copy_package "angular-ssr" "ui" "angular-ssr"
copy_package "desktop-ui" "ui" "desktop-ui"
copy_package "api-console-api" "ui" "api-console-api"
copy_package "api-console-gui" "ui" "api-console-gui"
copy_package "api-console-module" "ui" "api-console-module"
copy_package "framework-debug-api" "ui" "framework-debug-api"
copy_package "framework-debug-gui" "ui" "framework-debug-gui"
copy_package "orm-browser" "ui" "orm-browser"
copy_package "orm-browser-api" "ui" "orm-browser-api"
copy_package "orm-browser-gui" "ui" "orm-browser-gui"

echo ""
echo "✓ File consolidation complete!"
