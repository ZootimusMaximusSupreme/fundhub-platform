import {loadFont} from '@remotion/google-fonts/Inter';

// Inter, the page's sans font (--sans). Loaded once for every template.
const inter = loadFont('normal', {
  weights: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
});

export const FONT_FAMILY = inter.fontFamily;
