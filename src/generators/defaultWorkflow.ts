/**
 * Qwen-Image-Edit, the built-in starter workflow: for installs with no single-file checkpoint (split
 * UNET/CLIP/VAE loaders instead) and, typically, a 4-step "Lightning" distillation LoRA. Takes up to
 * three reference images as part of its prompt conditioning (slots left unused are removed when
 * generating, see patchWorkflow), which fits this app's character/scene reference
 * art well. Model filenames are filled in from what the server actually has installed (see
 * listComfyQwenModels), not hardcoded.
 */
import type { ComfyNodeMapping, ComfyWorkflow } from './comfy';

export function buildQwenImageEditWorkflow(models: {
  unet: string;
  clip: string;
  vae: string;
  lora: string;
}): ComfyWorkflow {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'qwen_image' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    '4': {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['1', 0], lora_name: models.lora, strength_model: 1 },
    },
    '5': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['4', 0], shift: 3.1 } },
    '10': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
    '13': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
    '14': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
    '6': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['2', 0],
        prompt: '',
        vae: ['3', 0],
        image1: ['10', 0],
        image2: ['13', 0],
        image3: ['14', 0],
      },
    },
    '7': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '8': { class_type: 'EmptySD3LatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
    '9': {
      class_type: 'KSampler',
      inputs: {
        model: ['5', 0],
        seed: 0,
        steps: 4,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['8', 0],
        denoise: 1,
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'vibecomics' } },
  };
}

export const QWEN_IMAGE_EDIT_NODES: ComfyNodeMapping = {
  positivePromptNodeId: '6',
  promptField: 'prompt',
  referenceImageNodeIds: ['10', '13', '14'],
  outputNodeId: '12',
  sizeNodeId: '8',
  seedNodeId: '9',
};
