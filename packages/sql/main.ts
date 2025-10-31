#!/usr/bin/env node
import { App } from '@7b/core';
import { appModule } from './src/app.module.js';

App.fromModule(appModule).run();
