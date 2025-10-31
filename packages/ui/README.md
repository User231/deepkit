# @7b/ui

Angular UI components and frontend integrations for 0x7B applications.

## Features

- Angular UI component library
- Type-safe forms with runtime validation
- Angular SSR support
- Desktop UI components
- API console and debugger
- ORM browser
- Framework debug tools

## Installation

```bash
npm install @7b/ui
```

### Optional Peer Dependencies

```bash
npm install @angular/core @angular/common rxjs
```

## Usage

```typescript
import { Component } from '@angular/core';
import { validates } from '@7b/ui/forms';

interface User {
  name: string;
  email: string;
}

@Component({
  selector: 'user-form',
  template: `
    <form [formGroup]="form">
      <input formControlName="name" />
      <input formControlName="email" />
    </form>
  `
})
export class UserFormComponent {
  // Type-safe form with runtime validation
  form = validates<User>();
}
```

## Documentation

See the [full documentation](https://deepkit.io/documentation/angular) for details.
