import MarkdownIt from 'markdown-it';
window.VBMarkdown = new MarkdownIt({html:false,linkify:false,typographer:false});

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
window.VBTurndown = { Service: TurndownService, gfm };
