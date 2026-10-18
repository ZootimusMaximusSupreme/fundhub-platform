/* Shared type only: no authentication, data, navigation or API behavior. */
(function(root){
 "use strict";
 var doc=root.document;if(!doc||!doc.documentElement)return;
 var html=doc.documentElement;
 var platform=String(root.navigator&&(root.navigator.userAgentData&&root.navigator.userAgentData.platform||root.navigator.platform)||"");
 if(/Mac|iPhone|iPad|iPod/i.test(platform))html.setAttribute("data-fh-apple-rounded","");
 function applyBrand(brand,staff){
  var role=String(staff&&staff.role||"").toLowerCase();
  var own=!brand||(brand.slug==="fundhub"&&brand.entity_name==="Fundhub"&&brand.display_face==="Inter"&&role!=="partner");
  if(own)html.setAttribute("data-fh-rounded-default","");else html.removeAttribute("data-fh-rounded-default");
  return own;
 }
 root.FHFundhubType={applyBrand:applyBrand};
 applyBrand(null,null);
})(typeof window!=="undefined"?window:globalThis);
