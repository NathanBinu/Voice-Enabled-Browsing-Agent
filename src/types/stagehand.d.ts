declare module '@browserbasehq/stagehand' {
    // Minimal shim so we can compile even if the Stagehand package updates.
    const Stagehand: any;
    export default Stagehand;
}
