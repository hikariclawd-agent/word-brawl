import { getBuildMetadata, writeBuildMetadataFile } from './lib.mjs';

writeBuildMetadataFile(getBuildMetadata());
console.log('Wrote apps/mobile/src/generated/buildMetadata.ts');

