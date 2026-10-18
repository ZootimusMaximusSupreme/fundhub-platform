import{test,expect}from'@playwright/test';
import{openScreen,CLIENT_ID}from'./harness.mjs';
test('client workspace keeps the authenticated tenant font and colors',async({page})=>{
 const brand={slug:'custom-company',entity_name:'Example Company',display_face:'Montserrat',mono_face:'JetBrains Mono',ink:'#193746',paper:'#faf5eb',ramp:['#F2A69B','#F0BE94','#E9DDA4','#A8CBA9','#9EC2D5','#B8A5D4']};
 const session={ok:true,principal:'client',staff:{id:'safe-account',client_id:CLIENT_ID,role:'client',name:'Safe Client',status:'active',had_call:true}};
 await openScreen(page,'/app/client-portal.html',session,{'/api/org-brand':{ok:true,brand},'/api/read/portal-summary':{ok:true,scores:{},documents:[]},'/api/read/affiliate-portal':{ok:true,enrolled:false}});
 await expect(page.locator('.client-ios-nav')).toBeVisible();
 await expect(page.locator('html')).not.toHaveAttribute('data-fh-rounded-default','');
 const type=await page.locator('body').evaluate(e=>({font:getComputedStyle(e).fontFamily,paper:getComputedStyle(e).backgroundColor,ink:getComputedStyle(e).color}));
 expect(type.font).toContain('Montserrat');expect(type.paper).toBe('rgb(250, 245, 235)');expect(type.ink).toBe('rgb(25, 55, 70)');
 await expect(page.getByRole('link',{name:'Client portal home',exact:true})).toHaveAttribute('href','/app/client-portal.html');
 const image=await page.locator('.client-ios-brand-logo').evaluate(e=>getComputedStyle(e).backgroundImage);
 expect(image).not.toBe('none');
});
