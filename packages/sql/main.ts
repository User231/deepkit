#!/usr/bin/env node
import { App } from '@d7/app';
import { appModule } from './src/app.module.js';

App.fromModule(appModule).run();
