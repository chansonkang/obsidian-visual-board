import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanLanguage,translate} from '../src/i18n';
test('language settings default to Chinese and accept the English preference',()=>{for(const raw of [undefined,null,'fr','zh',{},1])assert.equal(cleanLanguage(raw),'zh');assert.equal(cleanLanguage('en'),'en');});
test('native UI translations leave unrecognized Vault content untouched',()=>{assert.equal(translate('en','打开画板'),'Open Board');assert.equal(translate('zh','打开画板'),'打开画板');for(const value of ['我的桌面','Notes/添加文章.md','# 标题 1\n\n文章正文','Chanson'])assert.equal(translate('en',value),value);});
