import { command, packagePlugin } from './package.mjs';

const { marketplaceRoot } = await packagePlugin();
command('codex', ['plugin', 'marketplace', 'add', marketplaceRoot]);
command('codex', ['plugin', 'add', 'playrunner@playrunner']);
console.log(
  'Playrunner installed. Start a new Codex task and select the Playrunner skill.',
);
