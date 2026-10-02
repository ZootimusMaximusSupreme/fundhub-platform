// Remotion CLI settings for the Fundhub B-roll kit.
// See the W5 status file (ops/workflows/ad-scripts-2026-10-02/w5-status.md) for render commands.
import {Config} from '@remotion/cli/config';

Config.setEntryPoint('./src/index.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
