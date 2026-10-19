/* Provider preset only; credentials remain in the existing password field/session. */
(() => {
 const baseService=iconService;
 iconService=function(){
  baseService();const form=$('icon-service-panel').querySelector('.icon-service-form');if(!form)return;
  const label=document.createElement('label');label.textContent='生图服务';
  const select=document.createElement('select');select.dataset.testid='ai-provider';select.setAttribute('aria-label','生图服务');
  select.innerHTML='<option value="apimart">APImart</option><option value="compatible">其他兼容服务</option>';
  const base=$('ai-base-url'),model=$('ai-model');select.value=/^https:\/\/api\.apimart\.ai(?:\/|$)/.test(base.value)?'apimart':'compatible';
  const help=document.createElement('small');help.textContent='APImart 预设：GPT-4o Image，方形图标，生成后自动保存到本地。模型名称也可手动修改。';
  select.addEventListener('change',()=>{if(select.value==='apimart'){base.value='https://api.apimart.ai/v1';model.value='gpt-4o-image';}});
  label.append(select);form.querySelector('h3').after(label);label.after(help);
 };
})();
