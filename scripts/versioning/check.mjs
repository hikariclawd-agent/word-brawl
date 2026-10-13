import process from 'node:process';
import { checkVersionState } from './lib.mjs';

const result = checkVersionState();

for (const warning of result.warnings) {
  console.warn(`WARN ${warning}`);
}

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`FAIL ${error}`);
  }
  process.exit(1);
}

console.log(`OK Word Brawl ${result.mobile.appVersion} metadata is consistent (${result.mobile.buildIdentifier}).`);

