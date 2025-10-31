# Deepkit → 0x7B Restructuring: Discussion Documents

This directory contains comprehensive documentation for the proposed restructuring of the Deepkit framework into 0x7B. These documents are for **discussion and planning only** - no code changes are included.

## 📄 Document Overview

### Quick Start

**New to this proposal?** Start here:
1. Read [PROPOSAL.md](PROPOSAL.md) for the user-facing overview
2. Check [VISUAL_OVERVIEW.md](VISUAL_OVERVIEW.md) for diagrams and charts
3. Review [API_COMPARISON.md](API_COMPARISON.md) for API changes

**Want technical details?**
1. Read [RESTRUCTURING.md](RESTRUCTURING.md) for the complete technical analysis
2. Read [JIT_REMOVAL_STRATEGY.md](JIT_REMOVAL_STRATEGY.md) for the JIT elimination approach

---

## 📚 Document Guide

### [PROPOSAL.md](PROPOSAL.md) (11KB)
**User-facing overview and quick reference**

Perfect for:
- Understanding the high-level vision
- Quick examples and getting started
- FAQ and roadmap
- Sharing with stakeholders

Contains:
- Design philosophy
- Package structure overview
- Installation and usage examples
- Key differences from Deepkit
- Migration guide
- Timeline through Q4 2025

---

### [VISUAL_OVERVIEW.md](VISUAL_OVERVIEW.md) (20KB)
**Diagrams, charts, and visual comparisons**

Perfect for:
- Visual learners
- Presentations and discussions
- Understanding complexity reduction
- Seeing before/after comparisons

Contains:
- Package structure diagrams
- Dependency graph visualizations
- Installation size comparisons
- Code comparison examples
- Performance charts
- Migration flow diagram
- Timeline visualization
- Risk assessment matrix

---

### [API_COMPARISON.md](API_COMPARISON.md) (21KB)
**Detailed side-by-side API reference**

Perfect for:
- Developers planning migration
- Understanding specific API changes
- Evaluating breaking changes
- Learning new patterns

Contains before/after examples for:
- Type System & Reflection
- Serialization & Validation
- Dependency Injection
- HTTP Server
- RPC Framework
- ORM & Database
- CLI & Application
- Events
- Logging

Each section includes:
- Current Deepkit API
- Proposed 0x7B API
- Explanation of changes
- Migration guidance

---

### [RESTRUCTURING.md](RESTRUCTURING.md) (25KB)
**Complete technical deep dive**

Perfect for:
- Technical decision makers
- Understanding rationale
- Architecture planning
- Detailed implementation planning

Contains:
- Current state analysis (57+ packages)
- Proposed structure with mapping
- Detailed package responsibilities
- Dependency graph analysis
- Performance considerations
- Migration phases
- Open questions for discussion
- Contributing guidelines

---

### [JIT_REMOVAL_STRATEGY.md](JIT_REMOVAL_STRATEGY.md) (19KB)
**Technical implementation of JIT removal**

Perfect for:
- Understanding the biggest technical challenge
- Evaluating performance trade-offs
- Planning implementation
- POC development

Contains:
- How Deepkit uses JIT today
- Problems with `new Function()`
- Three proposed solutions:
  1. Build-time code generation (primary)
  2. Template interpreter (fallback)
  3. Hybrid approach (recommended)
- Performance projections
- Implementation details
- Proof-of-concept plan

---

## 🎯 Key Points

### The Problem
- **57+ packages**: Overwhelming for users
- **Complex dependencies**: Hard to understand
- **JIT compilation**: CSP issues, debugging problems
- **Trademark issues**: Must rename

### The Solution
- **7-10 focused packages**: Clear boundaries
- **Logical grouping**: Easy to navigate
- **Build-time optimization**: No JIT, CSP-safe
- **New name: 0x7B**: No trademark issues

### The Numbers
- **85% fewer packages**: 57+ → 7-10
- **40% smaller install**: ~50MB → ~30MB
- **95% performance**: Build-time vs JIT
- **30% less code**: Simplified APIs

### The Timeline
- **Q1 2025**: Foundation (runtime, reflection, codec)
- **Q2 2025**: Framework (DI, CLI, HTTP, RPC)
- **Q3 2025**: Database (ORM, adapters)
- **Q4 2025**: 1.0 Stable Release

---

## 💭 Discussion Questions

We need your feedback on:

### 1. Package Structure
- Is the consolidation logical?
- Should any packages be split or merged differently?
- Are subpackages (@7b/io/http) clear enough?

### 2. API Changes
- Are the simplified APIs better?
- Too many breaking changes?
- Should we maintain more compatibility?

### 3. JIT Removal
- Is build-time optimization acceptable?
- Is 95% performance target good enough?
- Should we keep JIT as an optional feature?

### 4. Performance
- Are the projected benchmarks realistic?
- What performance is critical to maintain?
- What trade-offs are acceptable?

### 5. Migration
- What additional migration tools are needed?
- What documentation would help most?
- How long should parallel maintenance last?

### 6. Timeline
- Is Q4 2025 realistic for 1.0?
- Should we do alpha/beta releases sooner?
- What should be in each release?

### 7. Naming
- Any concerns with "0x7B"?
- Any concerns with package names?
- Should we use different naming?

---

## 📊 Quick Comparison

### Installation

**Before (Deepkit)**:
```bash
npm install @deepkit/core @deepkit/type @deepkit/type-compiler \
  @deepkit/app @deepkit/framework @deepkit/injector \
  @deepkit/logger @deepkit/http @deepkit/orm \
  @deepkit/postgres @deepkit/sql pg
# 12 packages, ~50MB
```

**After (0x7B)**:
```bash
npm install @7b/core @7b/io @7b/db @7b/db/postgres pg
# 5 packages, ~30MB (40% smaller)
```

### Application Setup

**Before (Deepkit)** - 30 lines:
```typescript
import { App, AppModule } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { Logger } from '@deepkit/logger';
import { http, HttpRouter } from '@deepkit/http';
import { Database } from '@deepkit/orm';
import { PostgresAdapter } from '@deepkit/postgres';

class UserController {
  @http.GET('/users/:id')
  getUser(id: number) {
    return { id, name: 'John' };
  }
}

class MyModule extends AppModule {
  controllers = [UserController];
  providers = [
    {
      provide: Database,
      useFactory: () => new Database(
        new PostgresAdapter('postgres://localhost/db')
      )
    }
  ];
}

const app = new App({
  imports: [new FrameworkModule(), new MyModule()]
});

app.run();
```

**After (0x7B)** - 21 lines (30% reduction):
```typescript
import { App, Logger } from '@7b/core';
import { HttpServer, route } from '@7b/io/http';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

class UserController {
  @route.get('/users/:id')
  getUser(id: number) {
    return { id, name: 'John' };
  }
}

const app = new App();
app.use(HttpServer);
app.use(UserController);
app.use({
  provide: Database,
  useFactory: () => new Database(
    new PostgresAdapter('postgres://localhost/db')
  )
});

app.run();
```

---

## 🚀 Next Steps

### 1. Review & Feedback (Current)
- Read the documentation
- Provide feedback on structure
- Discuss concerns
- Suggest improvements

### 2. Build Proof of Concept
- Implement JIT-free reflection
- Implement JIT-free serialization
- Run performance benchmarks
- Validate the approach

### 3. Decision Point
- **If POC succeeds**: Proceed with implementation
- **If POC fails**: Iterate on approach or reconsider

### 4. Implementation (If approved)
- Begin package migration
- Iterative development
- Alpha/beta releases
- Community testing

### 5. Release
- 1.0 stable release
- Complete documentation
- Migration guide
- Example applications

---

## 💬 How to Provide Feedback

### GitHub Issues
- Open specific issues for concerns
- Tag with `restructuring` label
- Reference relevant documents

### GitHub Discussions
- General discussion
- Questions and clarifications
- Community input

### Discord
- Real-time discussion
- Quick questions
- Community chat
- Link: https://discord.gg/U24mryk7Wq

### Pull Request Comments
- Comment on this PR
- Suggest specific changes
- Ask questions

---

## 📖 Reading Order Recommendations

### For Developers
1. [PROPOSAL.md](PROPOSAL.md) - Get the overview
2. [API_COMPARISON.md](API_COMPARISON.md) - See your code changes
3. [VISUAL_OVERVIEW.md](VISUAL_OVERVIEW.md) - Understand the structure
4. [RESTRUCTURING.md](RESTRUCTURING.md) - Deep dive if interested

### For Architects
1. [RESTRUCTURING.md](RESTRUCTURING.md) - Complete technical analysis
2. [JIT_REMOVAL_STRATEGY.md](JIT_REMOVAL_STRATEGY.md) - Critical technical change
3. [VISUAL_OVERVIEW.md](VISUAL_OVERVIEW.md) - Visualizations and comparisons
4. [API_COMPARISON.md](API_COMPARISON.md) - API surface changes

### For Decision Makers
1. [VISUAL_OVERVIEW.md](VISUAL_OVERVIEW.md) - Charts and visualizations
2. [PROPOSAL.md](PROPOSAL.md) - High-level overview
3. [RESTRUCTURING.md](RESTRUCTURING.md) - Detailed rationale
4. [JIT_REMOVAL_STRATEGY.md](JIT_REMOVAL_STRATEGY.md) - Risk analysis

### For Contributors
1. [RESTRUCTURING.md](RESTRUCTURING.md) - Complete plan
2. [JIT_REMOVAL_STRATEGY.md](JIT_REMOVAL_STRATEGY.md) - Implementation details
3. [API_COMPARISON.md](API_COMPARISON.md) - API changes
4. [PROPOSAL.md](PROPOSAL.md) - Vision and goals

---

## ⚠️ Important Notes

### This is a Discussion
- **No code changes** in this PR
- **Not final** - everything is up for discussion
- **Community input wanted** - your feedback matters
- **Not committed** - decision pending POC results

### About "7 Packages"
- The "seven packages to rule them all" was just a gag
- We're not constrained to exactly 7 packages
- Focus is on logical organization, not a number
- Current plan is 7-10 packages, but flexible

### About Performance
- Performance numbers are **projections** based on prototypes
- Actual performance will be validated with POC
- 95% target is based on build-time optimization
- May adjust strategy based on benchmark results

### About Timeline
- Q4 2025 is a target, not a commitment
- Depends on POC results
- May adjust based on complexity
- Community feedback may affect timeline

---

## 📞 Contact

- **GitHub**: https://github.com/marcj/deepkit
- **Discord**: https://discord.gg/U24mryk7Wq
- **Issues**: https://github.com/marcj/deepkit/issues
- **Discussions**: https://github.com/marcj/deepkit/discussions

---

## 📝 License

These documents are part of the Deepkit project and follow the same MIT license.

---

**Thank you for taking the time to review this proposal!** Your feedback is crucial to making 0x7B the best it can be.
