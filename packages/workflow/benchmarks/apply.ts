/*
 * What one `Workflow.apply()` costs: the function `WorkflowDefinition.buildApplier()` builds, run
 * through a workflow of four transitions with a callback listener and two service listeners.
 *
 *   cd packages/workflow
 *   node --import @deepkit/run benchmarks/apply.ts                                # as the process runs it
 *   DEEPKIT_JIT_MODE=interpreted node --import @deepkit/run benchmarks/apply.ts   # interpreted
 *
 * `http` runs every request through a workflow, so this is a per-request cost. Times do not travel
 * between machines: its use is before-and-after on one machine, run a few times each way.
 */
import { getJitMode } from '@deepkit/core';
import { EventDispatcher, eventDispatcher } from '@deepkit/event';
import { InjectorContext, InjectorModule } from '@deepkit/injector';
import { Stopwatch } from '@deepkit/stopwatch';

import { WorkflowEvent, createWorkflow } from '../src/workflow.js';

class EndEvent extends WorkflowEvent {
    test: string = 'hi';
}

const flow = createWorkflow(
    'bench',
    { start: WorkflowEvent, doIt: WorkflowEvent, failed: WorkflowEvent, success: WorkflowEvent, end: EndEvent },
    { start: 'doIt', doIt: ['failed', 'success'], success: 'end', failed: 'end' },
);

let calls = 0;

class Counter {
    count = 0;
}

class Listener {
    constructor(private counter: Counter) {}

    @eventDispatcher.listen(flow.onDoIt)
    onDoIt() {
        this.counter.count++;
    }

    @eventDispatcher.listen(flow.onSuccess)
    onSuccess(event: typeof flow.onSuccess.event, counter: Counter) {
        counter.count++;
    }
}

const listenerModule = new InjectorModule([Counter, Listener]);
const context = new InjectorContext(listenerModule);
const dispatcher = new EventDispatcher(context);
dispatcher.registerListener(Listener, listenerModule);
dispatcher.listen(flow.onDoIt, () => {
    calls++;
});
dispatcher.listen(flow.onEnd, async () => {
    calls++;
});
const stopwatch = new Stopwatch();

/** Three calls of apply(): start → doIt → success → end. */
async function once(): Promise<void> {
    const w = flow.create('start', dispatcher, stopwatch);
    await w.apply('doIt');
    await w.apply('success');
    await w.apply('end', new EndEvent());
}

async function measure(turns: number): Promise<number> {
    const started = process.hrtime.bigint();
    for (let i = 0; i < turns; i++) await once();
    return Number(process.hrtime.bigint() - started) / (turns * 3);
}

async function main(): Promise<void> {
    const turns = Number(process.env.TURNS || 200_000);
    await measure(20_000);
    const rounds: number[] = [];
    for (let round = 0; round < 5; round++) rounds.push(await measure(turns));
    const best = Math.min(...rounds);
    const count = context.get(Counter).count;
    if (calls === 0 || count === 0) throw new Error('the listeners did not run');
    console.log(
        `workflow apply() — mode ${getJitMode()}: best ${best.toFixed(0)} ns, rounds ${rounds.map(r => r.toFixed(0)).join(' ')} ns`,
    );
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
