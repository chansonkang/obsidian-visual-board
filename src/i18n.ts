/** Native UI strings only; Vault names, paths, and Markdown are never translated. */
export type Language = 'zh' | 'en';
export function cleanLanguage(value:unknown):Language{return value==='en'?'en':'zh';}
const english:Record<string,string>={
 "画板布局未能安全读取，已停止写入并保留原文件。":"The Board layout could not be read safely. Saving has stopped and the existing files have been preserved.",
 "画板布局未能安全读取，已停止写入并保留原文件，请检查本地布局备份。":"The Board layout could not be read safely. Saving has stopped; the existing files and local backups have been preserved.",
 "已从本地备份恢复画板布局，原组件位置已保留。":"The Board layout was recovered from a local backup, preserving its component positions.",
 "画板布局保存失败，已保留上一次有效布局，请稍后重试。":"Could not save the Board layout. The previous valid layout has been preserved; please try again.",
 "布局会自动保存在本地，并保留最近 10 份排版备份。更新插件时请保留原有数据文件。":"Layouts are saved locally with the latest 10 arrangement backups. Keep your existing data files when updating the plugin.",

 '可视化桌面':'Visual Board',
 '打开可视化桌面':'Open Visual Board',
 '把当前文章放入画板':'Add the current note to the Board',
 'Visual Board · 可视化桌面':'Visual Board',
 '界面语言':'Interface language',
 '切换中文或英文，设置会保存在当前知识库中。':'Choose Chinese or English. This preference is saved in the current vault.',
 '删除组件会将对应本地文件或文件夹移入插件回收站；可撤销或从回收站恢复，原有排列保留。便签作为本地布局记录回收。':'Deleting a component moves its local file or folder to the plugin trash. Undo or restore it to recover its layout. Sticky notes are recycled as local layout records.',
 '打开画板':'Open Board',
 '新文章保存目录':'New note folder',
 '留空保存在知识库根目录。':'Leave empty to save in the vault root.',
 '图片附件目录':'Image attachment folder',
 '默认 Board 图标':'Default Board icon',
 '默认玻璃文件夹 + Lucide':'Glass folder + Lucide',
 'AI 主题图片':'AI theme image',
 '生图服务':'Image provider',
 '选择 APImart 可自动填写服务地址与模型；API Key 在新建 Board 内配置。':'Select APImart to fill in the endpoint and model. Configure your API key in the new Board dialog.',
 '其他兼容服务':'Other compatible service',
 'AI 模式在新建 Board 中配置服务地址、模型和本次会话密钥。只发送 Board 名称与配色；文章正文不发送。':'In AI mode, configure the endpoint, model, and session key in the new Board dialog. Only the Board name and colors are sent; note contents stay local.',
 '读取本地文章失败，请重新打开画板。':'Could not read local notes. Please reopen the Board.',
 '本地文章暂时无法刷新，请稍后再试。':'Local notes could not be refreshed. Please try again.',
};
export function translate(language:Language,key:string):string{return language==='en'?(english[key]??key):key;}
