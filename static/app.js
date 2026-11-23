'use strict';
const definitions={
 flight:{name:'رحلات الطيران',button:'ابحث عن الرحلات',fields:[['from','من','select',['بغداد','النجف','البصرة','مشهد','طهران']],['to','إلى','select',['مشهد','طهران','بغداد','النجف','إسطنبول']],['date','تاريخ السفر','date'],['passengers','المسافرون','select',['1','2','3','4']]]},
 hotel:{name:'الفنادق',button:'ابحث عن الفنادق',fields:[['city','المدينة','select',['مشهد','طهران','بغداد','أربيل','إسطنبول']],['checkin','تاريخ الدخول','date'],['checkout','تاريخ الخروج','date'],['guests','عدد الأشخاص','select',['1','2','3','4']]]},
 train:{name:'القطارات',button:'ابحث عن القطارات',fields:[['from','من','select',['طهران','مشهد','قم','أصفهان']],['to','إلى','select',['مشهد','طهران','قم','أصفهان']],['date','تاريخ الرحلة','date'],['passengers','الركاب','select',['1','2','3','4']]]},
 bus:{name:'الحافلات',button:'ابحث عن الحافلات',fields:[['from','من','select',['مشهد','طهران','قم','أصفهان']],['to','إلى','select',['طهران','مشهد','قم','أصفهان']],['date','تاريخ الرحلة','date'],['passengers','الركاب','select',['1','2','3','4']]]},
 topup:{name:'شحن الخطوط',button:'عرض خيارات الشحن',fields:[['operator','الشركة','select',['إيرانسل','همراه أول','رایتل']],['mobile','رقم الهاتف الإيراني','tel'],['amount','مبلغ الشحن (تومان)','select',['50000','100000','200000','500000']]]}
};
const $=id=>document.getElementById(id);
const fmt=n=>Number(n).toLocaleString('en-US');
let service='flight', currentUser=null, lastFields={};
async function api(path,method='GET',payload){
 const response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});
 const json=await response.json();if(!response.ok)throw new Error(json.error||'تعذّر الاتصال');return json;
}
function showModal(title){$('modalTitle').textContent=title;$('modalContent').replaceChildren();$('overlay').classList.add('show');}
function closeModal(){$('overlay').classList.remove('show');}
function message(text,error=false){const p=document.createElement('p');p.className=error?'negative':'positive';p.textContent=text;$('modalContent').append(p);}
function el(tag,txt,cls){const node=document.createElement(tag);if(txt!==undefined)node.textContent=txt;if(cls)node.className=cls;return node;}
function field(name,label,type){const group=el('div',undefined,'field');const l=el('label',label),i=el('input');i.name=name;i.type=type;i.required=true;l.append(i);group.append(l);return group;}
function accountDialog(mode='login'){
 showModal(mode==='register'?'إنشاء حساب جديد':'تسجيل الدخول');
 const form=el('form');
 if(mode==='register')form.append(field('name','الاسم الكامل','text'));
 form.append(field('email','البريد الإلكتروني','email'),field('password','كلمة المرور','password'));
 const password=form.querySelector('[name=password]');password.minLength=mode==='register'?10:1;
 const submit=el('button',mode==='register'?'إنشاء الحساب':'دخول','searchbtn');submit.type='submit';form.append(submit);
 const switcher=el('button',mode==='register'?'لديك حساب؟ تسجيل الدخول':'مستخدم جديد؟ إنشاء حساب','pill');switcher.type='button';switcher.style.marginTop='12px';switcher.onclick=()=>accountDialog(mode==='register'?'login':'register');
 const notice=el('p','');notice.setAttribute('aria-live','polite');form.append(notice);
 form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;const formData=Object.fromEntries(new FormData(form));try{const answer=await api(mode==='register'?'register':'login','POST',formData);if(mode==='register'){accountDialog('login');message(answer.message);}else{await refreshMe();closeModal();}}catch(err){notice.textContent=err.message;notice.className='negative';}finally{submit.disabled=false;}};
 $('modalContent').append(form,switcher);
}
async function refreshMe(){try{currentUser=(await api('me')).user;}catch{currentUser=null;}
 $('loginBtn').textContent=currentUser?'حسابي: '+currentUser.name:'حسابي';
 $('balance').textContent=fmt(currentUser?currentUser.demo_balance:0);
 $('adminBtn').hidden=!currentUser?.is_admin;
 $('addFunds').textContent=currentUser?'＋ إضافة رصيد افتراضي':'تسجيل الدخول للمحفظة';
 if(currentUser)await refreshLedger();else $('activities').replaceChildren(el('p','سجّل الدخول لعرض عملياتك التجريبية.','muted'));
}
function renderFields(){const d=definitions[service];$('searchFields').replaceChildren();
 for(const [id,label,type,opts] of d.fields){const wrap=el('div',undefined,'field'),lab=el('label',label),control=document.createElement(type==='select'?'select':'input');control.id='field_'+id;control.name=id;control.required=true;lab.htmlFor=control.id;
 if(type==='select')for(const value of opts){const option=el('option',value);option.value=value;control.append(option);}else{control.type=type;if(type==='date'){const tomorrow=new Date(Date.now()+86400000);const day=tomorrow.toLocaleDateString('en-CA',{timeZone:'Asia/Tehran'});control.min=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tehran'});control.value=day;}if(type==='tel')control.placeholder='09xxxxxxxxx';}
 wrap.append(lab,control);$('searchFields').append(wrap);}
 $('searchAction').textContent=d.button;$('results').classList.remove('show');}
$('tabs').addEventListener('click',e=>{const button=e.target.closest('button[data-service]');if(!button)return;service=button.dataset.service;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===button));renderFields();});
function resultLine(item){const line=el('div',undefined,'resultline'),left=el('div'),right=el('div');left.append(el('strong',item.title),el('small',item.details));right.style.textAlign='left';right.append(el('strong',fmt(item.price)+' تومان'));
 const button=el('button','حفظ طلب تجريبي','smallbtn');button.onclick=async()=>{if(!currentUser){accountDialog();message('سجّل الدخول أولاً لحفظ الطلب.');return;}button.disabled=true;try{const data=await api('book','POST',{service,fields:lastFields,option:item.id});showModal('تم إنشاء الطلب التجريبي');message('رقم الطلب: '+data.booking_id+'. '+data.message);await loadBookings();}catch(err){showModal('خطأ');message(err.message,true);}finally{button.disabled=false;}};right.append(button);line.append(left,right);return line;}
$('searchForm').onsubmit=async e=>{e.preventDefault();const results=$('results');results.replaceChildren();lastFields=Object.fromEntries(new FormData(e.currentTarget));const searchingService=service;const btn=$('searchAction');btn.disabled=true;try{const data=await api('search','POST',{service:searchingService,fields:lastFields});results.append(el('h3','نتائج '+definitions[searchingService].name+' — بيانات وأسعار افتراضية'));for(const item of data.results)results.append(resultLine(item));}catch(err){results.append(el('p',err.message,'negative'));}finally{btn.disabled=false;results.classList.add('show');results.scrollIntoView({behavior:'smooth',block:'nearest'});}};
async function refreshLedger(){const box=$('activities');box.replaceChildren();try{const data=await api('ledger');if(!data.ledger.length)box.append(el('p','لا توجد عمليات حتى الآن.','muted'));for(const entry of data.ledger){const line=el('div',undefined,'activity');line.append(el('span',entry.note),el('strong','+'+fmt(entry.amount),'positive'));box.append(line);}}catch{box.append(el('p','تعذّر تحميل العمليات.','negative'));}}
async function loadBookings(){const box=$('bookingList');box.replaceChildren();if(!currentUser){box.append(el('p','سجّل الدخول للاطلاع على الطلبات.','muted'));return;}try{const data=await api('bookings');if(!data.bookings.length)box.append(el('p','لم تنشئ أي طلب تجريبي بعد.','muted'));for(const item of data.bookings){const line=el('div',undefined,'activity');line.append(el('span','#'+item.id+' — '+item.title),el('strong',fmt(item.price)+' تومان'));box.append(line);}}catch(err){box.append(el('p',err.message,'negative'));}}
$('loginBtn').onclick=()=>{if(!currentUser){accountDialog();return;}showModal('حساب الزبون');message('أهلاً '+currentUser.name+' — '+currentUser.email);const bookings=el('button','عرض طلباتي','pill');bookings.onclick=()=>{closeModal();$('myBookings').scrollIntoView({behavior:'smooth'});loadBookings();};const logout=el('button','تسجيل الخروج','pill');logout.style.marginInlineStart='8px';logout.onclick=async()=>{await api('logout','POST',{});currentUser=null;closeModal();await refreshMe();await loadBookings();};$('modalContent').append(bookings,logout);};
$('addFunds').onclick=async()=>{if(!currentUser){accountDialog();return;}showModal('إضافة رصيد افتراضي');message('هذه إضافة محاكاة فقط. لا يوجد تحويل مالي ولا رصيد قابل للاستخدام خارج الموقع.');const button=el('button','تأكيد إضافة 1,000,000 تومان افتراضية','searchbtn');button.onclick=async()=>{button.disabled=true;try{await api('demo-funds','POST',{});await refreshMe();showModal('تحديث المحفظة');message('تمت إضافة مليون تومان افتراضي إلى حسابك التجريبي.');}catch(err){message(err.message,true);}};$('modalContent').append(button);};
$('historyBtn').onclick=()=>{if(!currentUser){accountDialog();return;}$('activities').scrollIntoView({behavior:'smooth'});};
$('adminBtn').onclick=async()=>{if(!currentUser?.is_admin)return;try{const stats=await api('admin/stats');$('statUsers').textContent=fmt(stats.users);$('statBookings').textContent=fmt(stats.bookings);$('statTopups').textContent=fmt(stats.topups);$('dashboard').classList.add('show');$('dashboard').scrollIntoView({behavior:'smooth'});}catch(err){showModal('خطأ');message(err.message,true);}};
$('hideDashboard').onclick=()=>$('dashboard').classList.remove('show');
$('reloadBookings').onclick=loadBookings;
$('closeModal').onclick=closeModal;$('overlay').onclick=e=>{if(e.target===$('overlay'))closeModal();};window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
renderFields();refreshMe();loadBookings();
