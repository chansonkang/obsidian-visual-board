/* Localize application chrome only. Never walk note Markdown or user-generated titles. */
(() => {
 const english={
 "画板保存数据无效，已保留当前布局。":"Invalid Board save data. The current layout has been preserved.",
 "恢复副本保存失败，请保持画板打开。":"Could not save the recovery copy. Keep the Board open.",
 "恢复副本校验失败，请保持画板打开。":"Could not verify the recovery copy. Keep the Board open.",
 "画板布局保存失败，已保留恢复副本，请稍后重试。":"Could not save the Board layout. A recovery copy was preserved; please retry.",
 "恢复记录无效。":"Invalid recovery record.",
 "已保留并发修改副本，可在画板设置中查看。":"A copy of concurrent edits was preserved. Find it in Board settings.",
 "已保留未完成保存的恢复副本。":"A recovery copy of unfinished saves was preserved.",

 "画板布局未能安全读取，已停止写入并保留原文件。":"The Board layout could not be read safely. Saving has stopped and the existing files have been preserved.",
 "画板布局未能安全读取，已停止写入并保留原文件，请检查本地布局备份。":"The Board layout could not be read safely. Saving has stopped; the existing files and local backups have been preserved.",
 "已从本地备份恢复画板布局，原组件位置已保留。":"The Board layout was recovered from a local backup, preserving its component positions.",
 "画板布局保存失败，已保留上一次有效布局，请稍后重试。":"Could not save the Board layout. The previous valid layout has been preserved; please try again.",
 "布局会自动保存在本地，并保留最近 10 份排版备份。更新插件时请保留原有数据文件。":"Layouts are saved locally with the latest 10 arrangement backups. Keep your existing data files when updating the plugin.",

  "组件正在复制，请稍候。":"Components are being copied. Please wait.",
  "无法记录已插入的组件。":"Could not record the inserted components.",
  "此组件操作当前不能撤销或重做。":"This component action cannot currently be undone or redone.",
  "组件剪贴板已过期，或来自其他知识库，请重新复制。":"The component clipboard expired or belongs to another vault. Copy the components again.",
  "请选择已关联本地文件夹的目标画板。":"Select a destination Board linked to a local folder.",
  "目标文件夹已被移动或删除。":"The destination folder was moved or deleted.",
  "副本名称冲突过多，请更换目标文件夹。":"Too many copies have conflicting names. Choose another destination folder.",
  "复制目录路径无效。":"The copy destination path is invalid.",
  "组件对应的文件已被移动或删除。":"The component’s file was moved or deleted.",
  "一次复制的文件过多，请分批复制。":"Too many files were selected. Copy them in smaller batches.",
  "一次复制的文件超过 250 MB，请分批复制。":"The selected files exceed 250 MB. Copy them in smaller batches.",
  "不能复制整个知识库根目录。":"The entire vault root cannot be copied.",
  "一次复制的画板层级过多。":"Too many nested Boards were selected for one copy.",
  "一次复制的组件过多，请分批复制。":"Too many components were selected. Copy them in smaller batches.",
  "画板对应的文件夹已被移动或删除。":"The Board’s linked folder was moved or deleted.",
  "副本目标被其他操作占用，请重新粘贴。":"Another operation is using the copy destination. Paste again.",
  "新建文件夹未能加入知识库。":"The new folder could not be added to the vault.",
  "源文件在复制过程中已被移动或替换。":"The source file was moved or replaced while it was being copied.",
  "复制期间本地文件或画板已改变，请重新复制粘贴。":"Local files or Boards changed during copying. Copy and paste again.",
  "请选择本地 Markdown 文件。":"Select local Markdown files.",
  "只支持 .md 或 .markdown 文件。":"Only .md and .markdown files are supported.",
  "文件名无效，不能包含目录路径、隐藏名称或系统保留名称。":"The filename is invalid. Folder paths, hidden names and system-reserved names are not allowed.",
  "Markdown 文件超过 10 MiB，请选择较小的文件。":"The Markdown file exceeds 10 MiB. Select a smaller file.",
  "Markdown 文件字节无效。":"The Markdown file contains invalid bytes.",
  "Markdown 文件必须使用有效的 UTF-8 编码。":"Markdown files must use valid UTF-8 encoding.",
  "文件包含二进制内容，不能作为 Markdown 导入。":"The file contains binary data and cannot be imported as Markdown.",
  "目标画板未关联有效的本地文件夹，或文件夹位置已改变，请重新定位。":"The destination Board has no valid local folder, or the folder moved. Locate it again.",
  "每次请选择 1 至 32 个 Markdown 文件。":"Select between 1 and 32 Markdown files at a time.",
  "本次 Markdown 导入总量超过 40 MiB，请分批导入。":"The Markdown import exceeds 40 MiB. Import the files in smaller batches.",
  "Markdown 保存路径无效。":"The Markdown save path is invalid.",
  "Markdown 文件无法保存，请检查本地文件夹权限或磁盘空间。":"The Markdown file could not be saved. Check local folder permissions or available disk space.",
  "同名 Markdown 文件过多，请更换名称。":"Too many Markdown files have this name. Choose another name.",
  "文件保存后的位置无法确认，请检查本地文件夹。":"The saved file’s location could not be confirmed. Check the local folder.",
  "文件已保存，但位置同时发生变化，请在目录中重新定位。":"The file was saved, but its location changed. Locate it again in the file explorer.",
  "Markdown 文件导入失败，请检查本地文件夹。":"The Markdown file could not be imported. Check the local folder.",
  "组件正在处理，请稍候。":"Components are being processed. Please wait.",
  "请选择知识库中的 Markdown 文件。":"Select Markdown files inside this vault.",
  "请选择有效的目标文件夹。":"Select a valid destination folder.",
  "文章路径无效。":"The note path is invalid.",
  "知识库内找不到此 Markdown 文件。":"This Markdown file could not be found inside the vault.",
  "目标文件夹已改变，请重新拖入。":"The destination folder changed. Drag the file in again.",
  "文章目录尚未同步，请稍后再试。":"The note’s folder has not synced yet. Try again shortly.",
  "撤销方向无效。":"The undo or redo direction is invalid.",
  "文件未能移入。":"The file could not be moved into the folder.",
  'PDF · 本地':'PDF · LOCAL','AUDIO · 本地':'AUDIO · LOCAL',
  "请选择知识库内的普通文章或文件夹。":"Select a regular note or folder in this vault.",
  "此文章或文件夹已移动或删除，请刷新画板后重试。":"This note or folder was moved or deleted. Refresh the Board and try again.",
  "文件列表尚未打开，请先启用 Obsidian「文件列表」核心插件并打开侧栏。":"The file explorer is not open. Enable Obsidian’s File explorer core plugin and open its sidebar.",
  "文件列表定位失败，请重新打开文件列表侧栏后重试。":"Could not locate the entry. Reopen the file explorer sidebar and try again.",
  "文件夹名称不能为空。":"The folder name cannot be empty.",
  "不能使用隐藏文件夹或上级目录名称。":"Hidden folder names and parent-directory names are not allowed.",
  "文件夹名称不能包含路径分隔符或非法字符。":"Folder names cannot contain path separators or invalid characters.",
  "文件夹名称不能以点或空格结尾。":"Folder names cannot end with a period or space.",
  "此文件夹名称是系统保留名称。":"This folder name is reserved by the system.",
  "文件夹名称过长，请缩短后重试。":"The folder name is too long. Shorten it and try again.",
  "不能移动或重命名知识库根目录。":"The vault root cannot be moved or renamed.",
  "请选择知识库内的文件夹路径。":"Select a folder path inside this vault.",
  "文件夹路径不规范，请重新选择。":"The folder path is invalid. Select it again.",
  "目标父文件夹不存在，请先创建或重新选择。":"The destination parent folder does not exist. Create it or select another folder.",
  "此文件夹已被移动或删除。":"This folder was moved or deleted.",
  "同名文件已存在，无法创建文件夹。":"A file with this name already exists. The folder cannot be created.",
  "此目录中已有同名文件或文件夹，请更换名称。":"A file or folder with this name already exists here. Choose another name.",
  "不能将文件夹移到自己或自己的子文件夹。":"A folder cannot be moved into itself or one of its subfolders.",
  "目标目录中已有同名文件或文件夹，无法覆盖。":"A file or folder with this name already exists at the destination and cannot be overwritten.",
  "这篇文章正在移动，请稍候。":"This note is being moved. Please wait.",
  "这次移动已失效，请重新定位文章。":"This move is no longer valid. Locate the note again.",
  "移动记录与当前状态不一致，不能重复撤销或重做。":"The move record no longer matches the current state. It cannot be undone or redone again.",
  "文章或画板已被移动、删除，当前状态不能撤销。":"The note or Board was moved or deleted. This action cannot currently be undone.",
  "目标画板卡片发生冲突，当前移动不能撤销。":"There is a conflicting card on the destination Board. This move cannot currently be undone.",
  "文章在移动期间发生外部变化，请重新定位。":"The note changed elsewhere while it was being moved. Locate it again.",
  "文章已移动，但卡片状态发生变化，请重新定位。":"The note was moved, but the card changed. Locate it again.",
  "文章在保存期间发生外部变化，请重新定位。":"The note changed elsewhere while it was being saved. Locate it again.",
  "草稿内容无效。":"The draft content is invalid.",
  "回收站正在处理文件，请稍候再修改。":"The trash is processing files. Wait before making changes.",
  "文件正在回收或恢复，请稍后保存布局。":"Files are being deleted or restored. Wait before saving the layout.",
  "当前本地文件夹已移动或删除，请先重新定位。":"The current local folder was moved or deleted. Locate it again first.",
  "请先选择已关联的本地文件夹画板。":"Select a Board linked to a local folder first.",
  "此画板未关联文件夹，或是知识库根目录。":"This Board has no linked folder, or represents the vault root.",
  "请选择有效的本地文件夹画板。":"Select a valid local folder Board.",
  "请选择文章和有效的目标文件夹。":"Select a note and a valid destination folder.",
  "这篇文章已被移动或删除。":"This note was moved or deleted.",
  "目标画板中存在冲突的卡片，请刷新后重试。":"There is a conflicting card on the destination Board. Refresh and try again.",
  "文章在移动保存期间发生外部变化，请重新定位。":"The note changed elsewhere while the move was being saved. Locate it again.",
  "此链接地址不能打开。":"This link cannot be opened.",
  "图片来源地址无效。":"The image source URL is invalid.",
  "请选择本地文章或图片。":"Select a local note or image.",
  "无法识别该操作。":"This operation is not recognized.",
  "回收站正在处理文件，请稍候。":"The trash is processing files. Please wait.",
  "当前桌面文件适配器不支持安全恢复索引，文件尚未移动。":"The current desktop file adapter does not support safe index recovery. No files were moved.",
  "回收记录无效。":"The trash record is invalid.",
  "无法创建回收或恢复目录。":"Could not create the trash or restore directory.",
  "文件或文件夹已被移动或删除。":"The file or folder was moved or deleted.",
  "回收布局记录过大，文件尚未移动。":"The recycled layout record is too large. No files were moved.",
  "回收记录格式无效。":"The trash record format is invalid.",
  "回收路径记录无效。":"The recycled path record is invalid.",
  "回收文件缺少对应组件记录。":"A recycled file has no matching component record.",
  "回收组件记录无效。":"The recycled component record is invalid.",
  "回收画板记录无效。":"The recycled Board record is invalid.",
  "回收关系记录无效。":"The recycled connection record is invalid.",
  "回收选择记录无效。":"The recycled selection record is invalid.",
  "找不到可恢复的回收记录。":"No restorable trash record was found.",
  "请选择有效的组件。":"Select valid components.",
  "所选组件已发生变化，请重新选择。":"The selected components changed. Select them again.",
  "原父画板不存在，请先恢复父画板。":"The original parent Board no longer exists. Restore it first.",
  "原画板身份已被占用，不能覆盖当前画板。":"The original Board ID is already in use. The current Board cannot be overwritten.",
  "原画板关联目录已改变，不能覆盖当前画板。":"The original Board’s linked folder changed. The current Board cannot be overwritten.",
  "原所在画板已删除，不能恢复组件布局。":"The original Board was deleted. The component layout cannot be restored.",
  "组件身份已被占用，不能覆盖。":"The component ID is already in use and cannot be overwritten.",
  "目标已有同名文件或文件夹，不能覆盖。":"A file or folder with this name already exists at the destination and cannot be overwritten.",
  "请选择组件。":"Select components.",
  "所选组件已不存在。":"The selected components no longer exist.",
  "不能回收整个知识库根目录。":"The entire vault root cannot be moved to the trash.",
  "此组件的文件路径无效。":"This component’s file path is invalid.",
  "组件对应的文件类型已改变。":"The component’s file type changed.",
  "组件对应的文件类型已改变，文件尚未移动。":"The component’s file type changed. No files were moved.",
  "此记录已恢复，不能重复恢复。":"This record was already restored and cannot be restored again.",
  "原目录已有同名文件或文件夹，不能覆盖。":"A file or folder with this name already exists in the original directory and cannot be overwritten.",
  "回收文件已被删除或替换，无法恢复。":"The recycled file was deleted or replaced and cannot be restored.",
  "此记录当前不能重做删除。":"Deletion cannot currently be redone for this record.",
  "原文件已被替换或移动，不能重做删除。":"The original file was replaced or moved. Deletion cannot be redone.",
  "原组件状态已改变，不能重做删除。":"The original component changed. Deletion cannot be redone.",
  "请选择仓库内的相对路径。":"Select a relative path inside the vault.",
  "路径不能包含上级目录或控制字符。":"Paths cannot contain parent-directory segments or control characters.",
  "路径不能为空。":"The path cannot be empty.",
  "文章标题不能为空。":"The note title cannot be empty.",
  "标题不能包含路径分隔符或非法文件名字符。":"Titles cannot contain path separators or invalid filename characters.",
  "标题不能是上级目录，也不能以点或空格结尾。":"A title cannot be a parent-directory name or end with a period or space.",
  "此标题是系统保留的文件名，请更换名称。":"This title is a reserved filename. Choose another name.",
  "标题过长，请缩短后重试。":"The title is too long. Shorten it and try again.",
  "此目录中已有同名文件，请更换标题。":"A file with this name already exists in this folder. Choose another title.",
  "文章在改名后再次被移动，请重新定位原文。":"The note was moved again after being renamed. Locate the original note again.",
  "请选择知识库内的文章，不能移动隐藏目录或上级目录中的文件。":"Select a note inside the vault. Files in hidden or parent directories cannot be moved.",
  "目标文件夹路径无效，不能包含隐藏目录或上级目录。":"The destination folder path is invalid. Hidden and parent-directory segments are not allowed.",
  "目标文件夹不存在，或这个路径不是文件夹。":"The destination folder does not exist, or the path is not a folder.",
  "目标文件夹已有同名文件，不能覆盖原文。":"A file with this name already exists in the destination folder. The original cannot be overwritten.",
  "文章在移动后再次被移动，请重新定位原文。":"The note was moved again after the move. Locate the original note again.",
  "文章保存目录与现有文件重名。":"The note’s save folder conflicts with an existing file.",
  "同名文章过多，请更换名称。":"Too many notes have this name. Choose another name.",
  "已达到便签内容长度上限":"The sticky note has reached its content length limit",
  "粘贴内容超过便签长度上限":"The pasted content exceeds the sticky note’s length limit",
  "便签内容超过长度上限":"The sticky note’s content exceeds the length limit",
  "此便签已被移除":"This sticky note was removed",
  "请先处理文章保存冲突，再撤销组件操作。":"Resolve the note’s save conflict before undoing component changes.",
  "请先处理文章保存冲突，再删除组件。":"Resolve the note’s save conflict before deleting components.",
  "文章正在移动，请稍候":"The note is being moved. Please wait",
  "目标文件夹已移动或删除":"The destination folder was moved or deleted",
  "请先处理文章保存冲突，再移动。":"Resolve the note’s save conflict before moving it.",
  "请填写画板名称":"Enter a Board name",
  "预览图片正在生成，请稍候":"The image preview is being generated. Please wait",
  "请先处理文章草稿保存提示。":"Resolve the note’s draft save warning first.",
  "文件夹已保存，请刷新画板目录。":"The folder was saved. Refresh the Board list.",
  "正文草稿尚未保存，请先处理正文保存提示。":"The note’s draft has not been saved. Resolve its save warning first.",
  "图片尺寸无效。":"The image dimensions are invalid.",
  "图片无法解码，请重新选择 PNG、JPEG、WebP 或 GIF。":"Could not decode the image. Select a PNG, JPEG, WebP, or GIF image.",
  "本地音频内容无效。":"The local audio content is invalid.",
  "音频超过 100 MiB。":"The audio file exceeds 100 MiB.",
  "无法读取此文件。":"Could not read this file.",
  "文件超过 100 MiB，请使用较小的文件。":"The file exceeds 100 MiB. Choose a smaller file.",
  "请选择一张图片或填写图片网址。":"Select an image or enter an image URL.",
  "请先处理文章草稿冲突，再插入图片。":"Resolve the note’s draft conflict before inserting an image.",
  "无法读取图片":"Could not read the image",
  "图片已保存到附件目录，此次放置已取消。":"The image was saved to the attachment folder. Placement was canceled.",
  "原画板已删除，图片已保存到附件目录，请重新放置。":"The original Board was deleted. The image was saved to the attachment folder; place it again.",
  "原图片卡片已被移除，附件已保存到本地。":"The original image card was removed. The attachment was saved locally.",
  "原文章已移动或删除，图片已保存到附件目录。":"The original note was moved or deleted. The image was saved to the attachment folder.",
  "图片已保存，但文章已发生变化，请重新选择插入位置。":"The image was saved, but the note changed. Select a new insertion point.",
  "已切换画板，图片已保存到附件目录，请返回原画板放置。":"The Board changed. The image was saved to the attachment folder; return to the original Board to place it.",
  "请填写 0 到 2000 的排列间距。":"Enter an arrangement spacing between 0 and 2000.",
  "此链接类型无法在画板中打开":"This link type cannot be opened on the Board",
  "未找到对应的本地文章":"The corresponding local note was not found",
  "操作失败，请重试。":"The operation failed. Please try again.",
  '奶黄':'Butter yellow','画布缩放预设':'Canvas zoom presets','图片暂时无法显示，可点击更换图片':'The image cannot be displayed. Click Replace image to choose another.','正在读取本地图片…':'Loading local image…','图片附件已移动或删除':'The image attachment was moved or deleted',
  '草稿恢复副本保存失败，请保持此页打开':'Could not save the recovery draft. Keep this page open','已恢复上次未保存草稿，请确认后保存':'Unsaved draft recovered. Review it before saving','原文已在别处修改，草稿已保留':'The note changed elsewhere; your draft is preserved',
  '通用文件夹':'General folder','财务':'Finance','语言':'Languages','游戏':'Games','产品思考':'Product thinking','猫咪':'Cats','鸟类':'Birds','鱼类':'Fish','昆虫':'Insects','旅行':'Travel','写作':'Writing','阅读':'Reading','编程':'Coding','音乐':'Music','健康':'Health','用户研究':'User research','灵感':'Ideas','实验':'Experiments','知识地图':'Knowledge map','工作项目':'Work projects','摄影':'Photography','咖啡':'Coffee','学习':'Learning','世界':'World','植物':'Plants','森林':'Forest','设计':'Design','健身':'Fitness','美食':'Food','关系网络':'Network','播客':'Podcasts','电影':'Film','创新':'Innovation','历史':'History','笔记':'Notes',
  '完成':'Done','圆点列表':'Bulleted list','编号列表':'Numbered list','请选择 2–6 列、1–10 行正文。':'Choose 2–6 columns and 1–10 body rows.','文章已变化，请关闭后重新选择插入位置。':'The note changed. Close this panel and select a new insertion point.','列':'Column',
  '正文尚未保存。要放弃这次修改吗？':'The note has unsaved changes. Discard them?',
  '切换界面语言':'Switch interface language','界面语言':'Interface language','语言设置保存失败':'Could not save the language preference',
  '所有画板':'All Boards','本地文件夹与画板':'Local folders and Boards','显示知识链接':'Show knowledge links','移动选中卡片':'Move selected card','重命名当前画板':'Rename current Board','画板层级':'Board hierarchy','搜索':'Search','搜索示例文章':'Search notes','搜索文章':'Search notes','新建 Board':'New Board','添加子画板':'Add nested Board','新建子画板':'New nested Board',
  '选择工具':'Select','添加文章':'Add note','添加便利贴':'Add sticky note','手动画板连线':'Connect components','移除选中卡片':'Delete selected card','移到回收站':'Move to trash','画板设置':'Board settings','画布缩放':'Canvas zoom','缩小画布，按10%步长':'Zoom out in 10% steps','缩小画布，每次10%':'Zoom out in 10% steps','选择卡片':'Select card','移动这张卡片':'Move this card','拖动文章卡片':'Drag note card','拖动文章':'Drag note','拖动便签':'Drag sticky note','完成编辑':'Finish editing','在 Obsidian 打开':'Open in Obsidian','在 Obsidian 中打开':'Open in Obsidian',
  '进入 Board ↗':'Open Board ↗','移到画板 ↗':'Move to Board ↗','重命名':'Rename','重新生成图标':'Regenerate icon','移除入口':'Remove entry','复制链接':'Copy link','在文件列表中显示':'Reveal in file explorer','适配文章尺寸':'Fit card to note','文章联系':'Note links','修改样式':'Edit style','编辑便签':'Edit sticky note','便签样式':'Sticky note style','取消选择':'Deselect',
  '一个新的思考空间':'A new space for your ideas','放进一篇文章，或创建子画板。':'Add a note or create a nested Board.','每一层都可以继续深入。':'Keep exploring at every level.','＋ 添加文章':'＋ Add note','＋ 新建子画板':'＋ New nested Board',
  '取消':'Cancel','关闭':'Close','保存':'Save','保存修改':'Save changes','保存设置':'Save settings','关闭对话框':'Close dialog','放到画板':'Add to Board','标题':'Title','正文':'Body','便签标题':'Sticky note title','便签正文':'Sticky note body','便利贴标题':'Sticky note title','便利贴内容':'Sticky note body','新建便利贴':'New sticky note','记下一个想法…':'Write down an idea…','点击填写标题':'Click to add a title','点击记录想法…':'Click to capture an idea…','便利贴只保存在画板中。':'Sticky notes are saved in this Board.','保留原便签的位置、颜色和尺寸。':'Keep the sticky note’s position, color, and size.',
  '便签颜色与叠放顺序':'Sticky note color and stacking','关闭便签样式':'Close sticky note style','颜色':'Color','叠放顺序':'Stacking order','置顶':'Bring to front','置底':'Send to back','前移一层':'Bring forward','后移一层':'Send backward','浅绿':'Light green','浅黄':'Light yellow','浅粉':'Light pink','浅蓝':'Light blue','淡紫':'Lavender','米白':'Ivory','绿色':'Green','黄色':'Yellow','粉色':'Pink','蓝色':'Blue','紫色':'Purple','白色':'White',
  '多选组件排列':'Arrange selected components','取消多选':'Clear selection','Shift 点击增减 · Shift 拖空白框选':'Shift-click to toggle · Shift-drag to select','Shift 点击多选 · Shift 拖动空白框选':'Shift-click to select · Shift-drag a selection box','间距':'Spacing','排列间距':'Arrangement spacing','横向等距':'Distribute horizontally','纵向等距':'Distribute vertically','左对齐':'Align left','水平居中':'Center horizontally','右对齐':'Align right','顶部对齐':'Align top','垂直居中':'Center vertically','底部对齐':'Align bottom','整理到一起':'Bring together','恢复入口':'Restore entry','这里包含已隐藏入口的画板。移除入口保留画板与原文，可随时恢复。':'Includes Boards with hidden entries. Their notes and layouts remain available.',
  '按住并拖动，连接到其他组件':'Drag to connect to another component','按住拖到其他组件以连接':'Drag to another component to connect','编辑关系连线':'Edit connection','编辑画板连线':'Edit Board connection','编辑文章链接':'Edit note link','画板连线':'Board connection','文章链接':'Note link','关闭连线编辑':'Close connection editor','实线':'Solid','虚线':'Dashed','线条粗细':'Line width','恢复默认':'Reset to default','删除连线':'Delete connection','在此画板隐藏':'Hide on this Board','只隐藏当前画板中的连线，原文双向链接保留。':'Hide the connection on this Board only. The note’s backlinks are kept.',
  '重命名 Board':'Rename Board','修改 Board 样式与名称':'Edit Board style and name','默认图标':'Default icon','AI 生成':'AI generation','Board 名称':'Board name','画板名称':'Board name','给画板起个名字':'Name this Board','输入名称后自动匹配主题，也可以手动选择贴纸。':'An icon is matched to the name. You can also choose a sticker.','根据名称匹配图标，或联网生成图片并保存到本地。':'Match an icon to the name, or generate an image online and save it locally.','名称与本地文件夹同步，图标可单独设置。':'The name syncs with the local folder. The icon can be customized.','创建 Board':'Create Board','玻璃文件夹 · 自由组合':'Glass folder · Mix and match','文件夹颜色':'Folder color','颜色与贴纸可以自由组合，全部保存在本地。':'Mix folder colors and stickers. Everything is saved locally.','颜色与贴纸独立选择，无需联网':'Choose colors and stickers independently, with no network required','按名称匹配贴纸':'Match sticker to name','已自定义':'Customized','按名称匹配':'Matched to name','雾紫':'Lavender','玫粉':'Rose','暖桃':'Peach','薄荷':'Mint','晴蓝':'Sky','奶杏':'Sand','雾灰':'Slate','文件夹':'Folder','玻璃文件夹':'Glass folder','AI 主题图标':'AI theme icon','默认文件夹 · 开源贴纸':'Default folder · Open-source sticker','已匹配':'Matched','待生成':'Not generated','生成中':'Generating','已生成':'Generated','生成失败':'Generation failed','统一文件夹样式，无需联网':'Consistent folder style, no network required','生成的图片保存在本地，离线也能使用':'Generated images are saved locally and available offline','选择贴纸':'Choose sticker','生成预览':'Generate preview','↻ 重新生成':'↻ Regenerate','配置图像服务':'Configure image provider','用默认图标继续':'Continue with default icon','正在生成…':'Generating…','生成失败 · 默认图标':'Generation failed · Default icon','点击创建时联网生成；也可以先预览效果。':'Generate online when creating the Board, or preview it first.',
  '图像服务配置':'Image service settings','服务地址':'Endpoint','图像服务地址':'Image service endpoint','模型':'Model','图像模型':'Image model','图像服务 API Key':'Image service API key','生图服务':'Image provider','其他兼容服务':'Other compatible service','保存本次配置':'Save session settings','APImart 预设：GPT-4o Image，方形图标，生成后自动保存到本地。模型名称也可手动修改。':'APImart preset: GPT-4o Image, square icons, saved locally after generation. You can also change the model.','密钥只保留在本次会话内存。生成会联网并产生服务费用；图片落在知识库附件目录。':'The key stays in session memory only. Generation uses the network and incurs provider charges; images are saved in the vault’s attachment folder.','密钥只保留在本次会话内存。生成会联网并产生服务费用；图片落在本地原型目录。':'The key stays in session memory only. Generation uses the network and incurs provider charges; images are saved locally.','请检查图像服务配置。':'Check the image service settings.','尚未配置图像服务。可以配置后生成，或用默认图标继续。':'No image service is configured. Configure it to generate an icon, or continue with a default icon.',
  '搜索并定位':'Search and locate','检索文章标题、正文和画板名称，直接回到对应位置。':'Search note titles, contents, and Board names, then jump to a match.','搜索文章正文或画板':'Search notes or Boards','输入标题、正文关键词或画板名称…':'Enter a title, keyword, or Board name…','画板':'Boards','文章':'Notes','定位 ↗':'Locate ↗','打开原文 ↗':'Open note ↗','尚未放入画板':'Not on a Board','＋ 添加':'＋ Add','没有找到匹配内容。试试其他关键词。':'No matches found. Try another keyword.','选取已有文章放入当前画板，或新建一篇文章。所有引用同步同一份正文。':'Add an existing note to this Board, or create a new one. All references share the same note contents.','搜索已有文章或输入新文章标题':'Find an existing note or enter a new note title','搜索已有文章，或输入新文章标题…':'Find an existing note, or enter a new title…','＋ 新建文章':'＋ New note','没有找到已有文章，可以用这个标题新建。':'No existing note found. Create one with this title.',
  'MARKDOWN · 本地原文':'MARKDOWN · LOCAL NOTE','MARKDOWN · 本地':'MARKDOWN · LOCAL','关闭文章预览':'Close note preview','在卡片中编辑':'Edit in card','在 Obsidian 定位此行':'Reveal this line in Obsidian','出链':'Outgoing links','反向链接':'Backlinks','原文已移动或删除，可以移除此引用。':'The original note was moved or deleted. This reference can be removed.',
  '添加图片':'Add image','更换图片':'Replace image','图片网址':'Image URL','https://… 图片地址':'https://… Image URL','选择本地图片、粘贴图片，或填写图片网址。图片保存到知识库附件目录。':'Choose a local image, paste an image, or enter its URL. Images are saved to the vault’s attachment folder.','插入选中的文章正文':'Insert into the selected note','放入图片':'Add image','添加 PDF 或音频':'Add PDF or audio','导入本地文件，或引用知识库里已有的文件。':'Import a local file, or reference an existing vault file.','音频播放进度自动保存到本地。':'Audio playback position is saved locally.','导入文件':'Import files','正在读取知识库…':'Reading vault…','知识库中的文件':'Files in this vault','暂时没有 PDF 或音频，可从上方导入。':'No PDFs or audio files yet. Import one above.','上一页':'Previous page','下一页':'Next page','正在读取 PDF…':'Loading PDF…','PDF 需要密码，请在 Obsidian 中打开。':'This PDF requires a password. Open it in Obsidian.','PDF 预览失败，可在 Obsidian 中打开。':'Could not preview PDF. Open it in Obsidian.','播放':'Play','暂停':'Pause','播放进度':'Playback position','静音':'Mute','取消静音':'Unmute','后退10秒':'Rewind 10 seconds','前进10秒':'Forward 10 seconds','重试':'Retry','正在读取本地音频…':'Loading local audio…','音频暂时无法播放。':'Audio cannot be played right now.','音频无法读取。':'Could not read the audio file.','附件已移动或删除，重新选择后可继续。':'The attachment was moved or deleted. Select it again to continue.',
  '知识链接 · 本地出链与反向链接':'Knowledge links · Local outgoing links and backlinks','显示知识虚线':'Show knowledge links','画板连线 · 手动空间关系':'Board connections · Manual spatial relationships','显示手动实线':'Show manual connections','点击卡片正文直接编辑，修改自动保存。删除组件会将对应本地文件移入回收站。':'Click a note’s contents to edit directly. Changes are saved automatically. Deleting a component moves its local file to the trash.','删除组件会将对应本地文件移入回收站。':'Deleting a component moves its local file to the trash.','文章目录与默认图标可在 Obsidian 插件设置中调整。':'Change the note folder and default icon in Obsidian’s plugin settings.','导出画板布局':'Export Board layout','回收站':'Trash','正在读取回收记录…':'Loading trash records…','恢复会保留原路径、位置、尺寸和排列；同名文件存在时不会覆盖。':'Restore the original path, position, size, and layout. Existing files with the same name will not be overwritten.','回收站里暂时没有组件。':'The trash is empty.','已恢复':'Restored','恢复原位置':'Restore original position','刷新记录':'Refresh records','已删除组件':'Deleted components',
  '移动本地文件夹':'Move local folder','目标文件夹':'Destination folder','移动文件夹':'Move folder','移动到另一个画板':'Move to another Board','目标画板':'Destination Board','移动卡片':'Move card','不能把画板移到自己或自己的后代。':'A Board cannot be moved into itself or one of its descendants.','先选择要移动的文章或画板':'Select a note or Board to move first',
  '文章格式工具':'Note formatting tools','正文段落':'Paragraph','标题 1':'Heading 1','标题 2':'Heading 2','标题 3':'Heading 3','有序列表':'Numbered list','无序列表':'Bulleted list','加粗':'Bold','斜体':'Italic','引用':'Quote','插入表格':'Insert table','插入 Markdown 表格':'Insert Markdown table','列数':'Columns','正文行数':'Body rows','另含一行表头，插入在当前段落后。':'Includes a header row. Inserted after the current paragraph.','插入':'Insert','减少表格列数':'Remove a table column','增加表格列数':'Add a table column','减少表格正文行数':'Remove a table row','增加表格正文行数':'Add a table row','请将光标移到代码块或表格外的段落，再插入表格':'Move the cursor to a paragraph outside the code block or table to insert a table','请在纯文字段落中使用此格式':'Use this format in a text paragraph',
  '已保存 · 点击正文直接编辑':'Saved · Click the note to edit','正在保存到本地…':'Saving locally…','待保存…':'Waiting to save…','原文已删除，草稿已保留':'The note was deleted; your draft is preserved','保存失败，草稿已保留':'Save failed; your draft is preserved','查看当前文件内容并合并':'View the current file and merge changes','重新载入当前原文':'Reload current note','我已合并，保存草稿':'I have merged changes; save draft','保存恢复的草稿':'Save recovered draft','放弃草稿并载入原文':'Discard draft and reload note','重试保存':'Retry saving','正在保存标题…':'Saving title…','点击修改标题，Enter 保存，Esc 取消':'Click to edit title; Enter to save, Esc to cancel',
  '链接已复制':'Link copied','图片已保存到本地':'Image saved locally','文件已保存到本地画板':'Files saved to the local Board','名称与本地文件夹已同步':'Name synced with the local folder','文件夹已关联，当前文章位置保持':'Folder linked; current note position preserved','本地文件夹与画板层级已同步':'Local folder and Board hierarchy synced','内容已整理到一起':'Contents brought together','已移到回收站，可按 Command+Z 撤销':'Moved to trash. Press Command+Z to undo','已从回收站恢复，原来的位置与尺寸已保留':'Restored from trash with the original position and size','知识链接已显示':'Knowledge links shown','知识链接已隐藏':'Knowledge links hidden','先选择需要删除的组件':'Select components to delete first','已按文章长度适配，全文可在卡片内滚动':'Card fitted to the note. Scroll inside to read the full text','操作等待超时，请重试。':'The operation timed out. Please try again.','表格未保存，请检查卡片中的保存提示。':'The table was not saved. Check the card’s save status.','配置已保存，密钥仅留在本次会话':'Settings saved; the key is kept for this session only','配置已保存，密钥仅留在当前会话':'Settings saved; the key is kept for this session only',
 };
 const roots='header .controls,header .header-right,.bottom-toolbar,.settings,.zoom-controls,#empty,#selection-bar,#mode-banner,#popover,#preview,#modal-root,#edge-style-panel,#sticky-style-panel,#multiselect-panel,.vb-multiselect-hint,#connection-controls,#toast,#nodes .node-actions,#nodes .date,#nodes .paper .source,#nodes [data-open-media],#nodes .vb-inline-status,#nodes .vb-title-status,#nodes .vb-replace-image,#nodes .vb-media-body,#nodes .vb-media-footer,#nodes .vb-open-media,#nodes .vb-photo-status,#zoom-popover,.vb-toolbar-ghost';
 // These contain user data even when they are displayed inside a system dialog.
 const protectedContent='.vb-inline-editor,.vb-inline-title,.vb-sticky-editor,.folder-name,.folder-meta,.image-caption,.vb-music-title,.vb-music-format,.vb-media-source,#board-title,#crumbs,#selection-bar>span,#preview h2,#preview pre,#preview .vb-preview-markdown,#preview .path,#preview .relation,#search-results h4,#search-results .search-v3-board strong,#search-results .search-v3-board small,#search-results .search-v3-snippet>span:not(.search-v3-line-label):not(.search-v3-snippet-arrow),#search-results .search-v3-place>span,#search-results .search-v3-result-heading small,#library-results strong,#library-results small,.trash-record>strong,.trash-record .path,.trash-record small,[data-add-media],[data-nav]:not([data-testid="enter-selected-board"]),[data-locate-node],#move-target option,.vb-inline-status pre,textarea,input,script,style,svg';
 const textRecords=new WeakMap(),attributeRecords=new WeakMap();let language=window.__VB_INIT?.settings?.language==='en'?'en':'zh',committed=language,revision=0,pending=0,saveQueue=Promise.resolve(),queued=false;
 const normalize=value=>value==='en'?'en':'zh';
 function t(key){return language==='en'?(english[key]??key):key;}
 function dynamic(source){
  if(language!=='en')return source;
  const patterns=[
   [/^同一原文 · ([\s\S]*)$/,m=>'Shared note · '+m[1]],
   [/^文件列表定位失败：([\s\S]*)；文章路径：([\s\S]*)$/,m=>'Could not reveal in file explorer: '+m[1]+'; Note path: '+m[2]],
   [/^文章已保存：([\s\S]*)；文件列表定位失败：([\s\S]*)$/,m=>'Note saved: '+m[1]+'; Could not reveal in file explorer: '+m[2]],
   [/^(.+) · 可拖到画板$/,m=>(english[m[1]]??m[1])+' · Drag onto the Board'],
   [/^画布缩放 (\d+)%?%，选择预设$/,m=>'Canvas zoom '+m[1]+'%, choose a preset'],
   [/^保持图片比例缩放 (n|e|s|w|ne|se|sw|nw)$/,m=>'Resize image proportionally ('+m[1]+')'],
   [/^(上边|右边|下边|左边|右上角|右下角|左下角|左上角)拉伸文章卡片$/,m=>'Resize note card ('+({'上边':'top','右边':'right','下边':'bottom','左边':'left','右上角':'top right','右下角':'bottom right','左下角':'bottom left','左上角':'top left'}[m[1]])+')'],
   [/^已接入「([\s\S]*)」本地知识库。$/,m=>'Connected to local vault “'+m[1]+'”.'],
   [/^图片附件：([\s\S]*)$/,m=>'Image attachments: '+m[1]],
   [/^添加至「([\s\S]*)」$/,m=>'Add to “'+m[1]+'”'],
   [/^创建在「([\s\S]*)」中$/,m=>'Create in “'+m[1]+'”'],
   [/^在「([\s\S]*)」创建或关联文件夹，入口放在当前视野附近。$/,m=>'Create or link a folder in “'+m[1]+'”. Its entry appears near the current viewport.'],
   [/^移动「([\s\S]*)」及其文章、子文件夹。链接随 Obsidian 原生移动更新。$/,m=>'Move “'+m[1]+'” and its notes and subfolders. Obsidian updates their links.'],
   [/^当前画板内容 · (\d+)$/,m=>'Current Board contents · '+m[1]],
   [/^已选 (\d+) 个组件$/,m=>m[1]+' components selected'],
   [/^(\d+) × (\d+) · 拖动四边调整$/,m=>m[1]+' × '+m[2]+' · Drag edges to resize'],
   [/^恢复隐藏文章连线 · (\d+)$/,m=>'Restore hidden note connections · '+m[1]],
   [/^(找到 |示例库 · )(\d+) 篇文章 · (\d+) 个画板$/,m=>(m[1]==='找到 '?'Found ':'Vault · ')+m[2]+' notes · '+m[3]+' Boards'],
   [/^第 (\d+) 行$/,m=>'Line '+m[1]],
   [/^另有 (\d+) 处匹配$/,m=>m[1]+' more matches'],
   [/^定位至第 (\d+) 行([\s\S]*)$/,m=>'Located at line '+m[1]+m[2]],
   [/^(出链|反向链接) · (\d+)$/,m=>(m[1]==='出链'?'Outgoing links':'Backlinks')+' · '+m[2]],
   [/^\s*(\d+) 个组件 · ([\s\S]*)$/,m=>m[1]+' components · '+m[2]],
   [/^(文件夹颜色|便签颜色) (.+)$/,m=>(m[1]==='文件夹颜色'?'Folder color':'Sticky note color')+' '+(english[m[2]]??m[2])],
   [/^(\d+) 秒 \/ (\d+) 秒$/,m=>m[1]+' seconds / '+m[2]+' seconds'],
   [/^(雾紫|玫粉|暖桃|薄荷|晴蓝|奶杏|雾灰) · ([\s\S]*)$/,m=>(english[m[1]]??m[1])+' · '+(english[m[2]]??m[2])],
  ];
  for(const[pattern,format]of patterns){const match=source.match(pattern);if(match)return format(match);}
  const prefixes={'文章已保存：':'Note saved: ','已在文件列表中定位：':'Revealed in file explorer: ','文件列表定位失败：':'Could not reveal in file explorer: ','画板保存失败：':'Could not save Board: ','图标生成失败：':'Icon generation failed: '};
  for(const[prefix,en]of Object.entries(prefixes))if(source.startsWith(prefix))return en+source.slice(prefix.length);
  return english[source]??source;
 }
 function translated(source){const trimmed=source.trim();if(!trimmed)return source;const result=dynamic(trimmed);return result===trimmed?source:source.slice(0,source.indexOf(trimmed))+result+source.slice(source.indexOf(trimmed)+trimmed.length);}
 function text(node){if(node.parentElement?.closest(protectedContent))return;const value=node.nodeValue,record=textRecords.get(node),source=record&&record.output===value?record.source:value,output=translated(source);textRecords.set(node,{source,output});if(value!==output)node.nodeValue=output;}
 const attrs=['title','aria-label','placeholder','data-placeholder','aria-valuetext'];
 function attributes(el){
  // Exact-key translations are safe even on editable elements; composed labels
  // containing a file title or a path stay untouched.
  if(el.closest('svg,script,style'))return;
  const protectedParent=el.closest(protectedContent);
  if(protectedParent&&!el.matches('.vb-inline-title,.vb-inline-editor,.vb-sticky-editor,input,textarea'))return;
  if(protectedParent&&protectedParent!==el&&!el.matches('input,textarea'))return;
  let records=attributeRecords.get(el);if(!records){records={};attributeRecords.set(el,records);}
  for(const attr of attrs){if(!el.hasAttribute(attr))continue;const value=el.getAttribute(attr),record=records[attr],source=record&&record.output===value?record.source:value;
   let output=english[source]!==undefined?t(source):el.closest(protectedContent)?source:dynamic(source);
   if(attr==='aria-label'&&language==='en'){if(el.matches('.vb-inline-editor'))output=source.replace(/ Markdown 正文$/,' Markdown body');else if(el.matches('.vb-inline-title'))output=source.replace(/ 文章标题$/,' note title');}
   records[attr]={source,output};if(value!==output)el.setAttribute(attr,output);
  }
  if(el.matches('header .controls button,header .header-right button,.bottom-toolbar button,.settings,.zoom-controls button')){
   const label=el.getAttribute('aria-label');if(label&&!el.getAttribute('title')){const record=records['aria-label'];el.setAttribute('title',label);records.title={source:record?.source||label,output:label};}
  }
 }
 function apply(root=document){
  const targets=root===document?[...document.querySelectorAll(roots)]:[...(root.matches?.(roots)?[root]:[]),...root.querySelectorAll?.(roots)||[]];
  for(const target of targets){if(target.closest(protectedContent))continue;const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest(protectedContent)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let node;while(node=walker.nextNode())text(node);}
  // Attribute labels are changed without touching any editable subtree or value.
  const labeled=root===document?document.querySelectorAll('[title],[aria-label],[placeholder],[data-placeholder],[aria-valuetext]'):[root,...root.querySelectorAll?.('[title],[aria-label],[placeholder],[data-placeholder],[aria-valuetext]')||[]];
  for(const el of labeled)if(el.nodeType===1)attributes(el);
  document.documentElement.lang=language==='en'?'en':'zh-CN';
 }
 function paint(value){const next=normalize(value),changed=next!==language;language=next;apply();if(changed)window.dispatchEvent(new CustomEvent('vb-language-change',{detail:{language}}));}
 async function setLanguage(value,{persist=true}={}){
  const next=normalize(value);if(!persist){committed=next;if(!pending)paint(next);return language;}
  const current=++revision;pending++;paint(next);
  const job=saveQueue.catch(()=>{}).then(()=>window.VBHost.rpc('save-settings',{language:next}));saveQueue=job;
  try{const settings=await job;committed=normalize(settings?.language??next);if(current===revision)paint(committed);return language;}
  catch(error){if(current===revision)paint(committed);throw error;}
  finally{pending--;}
 }
 window.VBI18n={t,apply,setLanguage,get language(){return language;}};
 // A DOM batch may recreate chrome after a background snapshot or open a new
 // panel. Read-only localization leaves active Markdown editors and caret intact.
 const observer=new MutationObserver(records=>{if(queued||!records.some(record=>{const el=record.target.nodeType===1?record.target:record.target.parentElement;return el&&!el.closest(protectedContent);}))return;queued=true;queueMicrotask(()=>{queued=false;apply();});});
 observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:attrs});
 window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==window.__VB_CHANNEL||event.data.kind!=='vb-event')return;const{type,payload}=event.data;if(type==='language')void setLanguage(payload?.language,{persist:false});else if(type==='snapshot'&&payload?.settings&&Object.prototype.hasOwnProperty.call(payload.settings,'language'))void setLanguage(payload.settings.language,{persist:false});});
 // Browser-native confirmations also use UI text, without translating their
 // quoted user values or changing the operation the dialog confirms.
 const originalConfirm=window.confirm.bind(window);window.confirm=message=>originalConfirm(t(String(message)));
 apply();window.dispatchEvent(new CustomEvent('vb-language-change',{detail:{language}}));
})();
