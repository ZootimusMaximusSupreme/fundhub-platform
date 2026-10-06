// Meta's creative enhancements ("Advantage+ creative" features) — the list we
// turn OFF, one by one, on every ad creative we load.
//
// WHY ONE BY ONE. Since Marketing API v22.0 the "standard enhancements" bundle
// can no longer be opted in or out of; each feature is its own key under
// degrees_of_freedom_spec.creative_features_spec, set to
// {"enroll_status": "OPT_OUT"}. Several default to ON when a key is left out
// (Meta's reference says so for adapt_to_placement, description_automation and
// inline_comment), so a key missing from this list is a feature Meta may switch
// on by itself. The read-back (readCreativeFeatures in meta.mjs) stops a load on
// ANY key that comes back OPT_IN, listed here or not.
//
// WHY NOT EVERY NAME META HAS EVER USED. Meta refuses the whole request when a
// key it does not accept is sent (the same trap as the insights fields in
// meta.mjs). So a key goes in SENT only when a Meta documentation page for the
// current version names it as a creative_features_spec key.
//
// NEVER INVENTED. Every key below was copied from the sources in SOURCES on
// CHECKED_ON. Recheck monthly: open each URL, compare, update CHECKED_ON.

export const CHECKED_ON = "2026-10-05";

export const SOURCES = Object.freeze([
  {
    url: "https://developers.facebook.com/docs/marketing-api/reference/ad-creative-features-spec",
    what: "Graph API Reference v26.0: Ad Creative Features Spec — the field list (46 names)"
  },
  {
    url: "https://developers.facebook.com/documentation/ads-commerce/marketing-api/creative/advantage-creative/get-started",
    what: "Get Started with Advantage+ Creative — the features table, each OPT_IN or OPT_OUT"
  },
  {
    url: "https://developers.facebook.com/documentation/ads-commerce/marketing-api/creative/generative-ai-features",
    what: "Generative AI Features on Marketing API — text_generation, image_uncrop, image_background_gen"
  },
  {
    url: "https://developers.facebook.com/docs/marketing-api/reference/ad-account/adcreatives",
    what: "Ad Account Ad Creatives, Creating — creative_features_spec key enum on POST"
  },
  {
    url: "https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/version22.0",
    what: "v22.0 changelog — the STANDARD_ENHANCEMENTS bundle is no longer supported (opt in or out)"
  },
  {
    url: "https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreativefeaturesspec.py",
    what: "Meta's own Python SDK v26.0.2 (generated 2026-08-25): the full AdCreativeFeaturesSpec type, used only to confirm every SENT key is a real field"
  }
]);

/* SENT — every key createCreative opts out of. Each one is named by at least
   one Meta documentation page above, and each one is a field of Meta's v26
   AdCreativeFeaturesSpec type. Alphabetical. */
export const META_CREATIVE_FEATURE_KEYS = Object.freeze([
  "adapt_to_placement",
  "add_text_overlay",
  "ads_with_benefits",
  "biz_ai",
  "creative_stickers",
  "customize_product_recommendation",
  "description_automation",
  "enhance_cta",
  "fb_feed_tag",
  "fb_reels_tag",
  "fb_story_tag",
  "generate_cta",
  "hide_price",
  "ig_feed_tag",
  "ig_reels_tag",
  "ig_stream_tag",
  "ig_video_native_subtitle",
  "image_animation",
  "image_background_gen",
  "image_brightness_and_contrast",
  "image_templates",
  "image_text_translation",
  "image_touchups",
  "image_uncrop",
  "inline_comment",
  "local_store_extension",
  "media_order",
  "media_type_automation",
  "multi_photo_to_video",
  "music_generation",
  "pac_relaxation",
  "product_browsing",
  "product_extensions",
  "product_metadata_automation",
  "profile_card",
  "profile_extension",
  "replace_media_text",
  "reveal_details_over_time",
  "show_destination_blurbs",
  "show_summary",
  "site_extensions",
  "standard_enhancements_catalog",
  "text_extraction_for_headline",
  "text_extraction_for_tap_target",
  "text_generation",
  "text_optimizations",
  "text_overlay_translation",
  "text_translation",
  "translate_voiceover",
  "video_auto_crop",
  "video_filtering",
  "video_highlights",
  "video_to_image",
  "video_uncrop",
  "wa_mm_image_filtering",
  "wa_mm_text_truncation_length"
]);

/* NOT SENT, ON PURPOSE.
   standard_enhancements — the v22.0 changelog: opting in OR out of this bundle
   is no longer supported. Meta may still show it on a read; the read-back
   treats it like any other key and stops the load if it says OPT_IN. */
export const NOT_SENT = Object.freeze({
  standard_enhancements: "v22.0+: the bundle can no longer be opted in or out of; turn off its parts one by one instead"
});

/* IN META'S SDK TYPE BUT ON NO DOCUMENTATION PAGE (2026-10-05). Not sent,
   because no page says the create call takes them. The read-back still stops a
   load if any of them comes back OPT_IN; when that happens, check the docs and
   move the key up into META_CREATIVE_FEATURE_KEYS. */
export const SDK_ONLY_NOT_SENT = Object.freeze([
  "advantage_plus_creative", "app_highlights", "audio", "auto_promotion_tag",
  "carousel_to_video", "catalog_feed_tag", "cv_transformation", "dha_optimization",
  "dynamic_cta_text", "dynamic_partner_content", "enable_ncs_testimonials",
  "feed_caption_optimization", "hyperlink_formatting", "ig_glados_feed",
  "image_auto_crop", "image_banner", "image_end_card", "image_enhancement",
  "media_liquidity_animated_image", "multi_creative_post_carousel",
  "pac_genai_recomposition", "pac_recomposition", "product_tags",
  "text_formatting_optimization", "video_highlight", "video_uncrop_9x16_to_9x18",
  "video_voiceover"
]);

/* Multi-advertiser ads ("contextual_multi_ads") is NOT a creative_features_spec
   key. It is its own field on the ad creative (AdCreative.contextual_multi_ads,
   type AdCreativeContextualMultiAds {enroll_status}) — Ad Creative reference
   and Ad Account Ad Creatives, Creating. createCreative sets it OPT_OUT there. */
export const CONTEXTUAL_MULTI_ADS_FIELD = "contextual_multi_ads";

export const OPT_OUT = Object.freeze({ enroll_status: "OPT_OUT" });

/* creativeFeaturesOptOut() → { <key>: { enroll_status: "OPT_OUT" }, … } for
   every SENT key. A fresh object each call, so a caller cannot mutate the next. */
export function creativeFeaturesOptOut() {
  const out = {};
  for (const k of META_CREATIVE_FEATURE_KEYS) out[k] = { enroll_status: "OPT_OUT" };
  return out;
}

export default {
  CHECKED_ON, SOURCES, META_CREATIVE_FEATURE_KEYS, NOT_SENT, SDK_ONLY_NOT_SENT,
  CONTEXTUAL_MULTI_ADS_FIELD, OPT_OUT, creativeFeaturesOptOut
};
