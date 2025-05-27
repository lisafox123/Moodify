// /lib/progressStore.js - Centralized progress store
let progressStore;

// Initialize the store only once
if (!global.progressStore) {
  global.progressStore = new Map();
  console.log('Initialized global progress store');
}

progressStore = global.progressStore;

// Progress step definitions with metadata
export const STEP_DEFINITIONS = {
  // === MOOD RECOMMENDATION STEPS ===
  'mood_analysis': {
    label: 'Analyzing your mood',
    icon: '🎭',
    order: 1,
    estimatedDuration: 2000,
    category: 'mood'
  },
  'library_fetch': {
    label: 'Scanning your music library',
    icon: '📚',
    order: 2,
    estimatedDuration: 3000,
    category: 'mood'
  },
  'ai_track_analysis': {
    label: 'AI selecting best matches',
    icon: '🤖',
    order: 3,
    estimatedDuration: 5000,
    category: 'mood'
  },
  'parallel_audd_analysis': {
    label: 'Analyzing audio features',
    icon: '🎵',
    order: 4,
    estimatedDuration: 8000,
    category: 'mood'
  },
  'semantic_evaluation': {
    label: 'Evaluating track quality',
    icon: '✨',
    order: 5,
    estimatedDuration: 3000,
    category: 'mood'
  },
  'quality_assurance': {
    label: 'Quality assurance check',
    icon: '🔍',
    order: 6,
    estimatedDuration: 2000,
    category: 'mood'
  },
  'finalizing': {
    label: 'Finalizing recommendations',
    icon: '🎯',
    order: 7,
    estimatedDuration: 1000,
    category: 'mood'
  },
  'story_generation': {
    label: 'Generating playlist story',
    icon: '📝',
    order: 8,
    estimatedDuration: 4000,
    category: 'mood'
  },
  'playlist_creation': {
    label: 'Creating Spotify playlist',
    icon: '🎵',
    order: 9,
    estimatedDuration: 3000,
    category: 'mood'
  },

  // === CLASSIC RECOMMENDATION STEPS ===
  'classic_workflow': {
    label: 'Initializing classic workflow',
    icon: '🎼',
    order: 1,
    estimatedDuration: 1000,
    category: 'classic'
  },
  'prompt_analysis': {
    label: 'Analyzing your music request',
    icon: '🔍',
    order: 2,
    estimatedDuration: 3000,
    category: 'classic'
  },
  'search_optimization': {
    label: 'Optimizing search queries',
    icon: '🎯',
    order: 3,
    estimatedDuration: 2000,
    category: 'classic'
  },
  'web_search': {
    label: 'Searching music databases',
    icon: '🌐',
    order: 4,
    estimatedDuration: 5000,
    category: 'classic'
  },
  'ai_generation': {
    label: 'AI generating recommendations',
    icon: '🤖',
    order: 5,
    estimatedDuration: 8000,
    category: 'classic'
  },
  'results_combination': {
    label: 'Combining search results',
    icon: '🔄',
    order: 6,
    estimatedDuration: 2000,
    category: 'classic'
  },
  'semantic_similarity': {
    label: 'Calculating similarity scores',
    icon: '📊',
    order: 7,
    estimatedDuration: 6000,
    category: 'classic'
  },
  'alignment_verification': {
    label: 'Verifying song alignment',
    icon: '✅',
    order: 8,
    estimatedDuration: 4000,
    category: 'classic'
  },
  'classic_generation': {
    label: 'Finalizing classic selections',
    icon: '🎵',
    order: 9,
    estimatedDuration: 3000,
    category: 'classic'
  },
  'spotify_search': {
    label: 'Finding songs on Spotify',
    icon: '🎧',
    order: 10,
    estimatedDuration: 7000,
    category: 'classic'
  },
  'classic_playlist_creation': {
    label: 'Creating classic playlist',
    icon: '📀',
    order: 11,
    estimatedDuration: 2000,
    category: 'classic'
  },

  // === SHARED/COMMON STEPS ===
  'initialization': {
    label: 'Initializing recommendation engine',
    icon: '⚡',
    order: 0,
    estimatedDuration: 500,
    category: 'shared'
  },
  'completion': {
    label: 'Completing recommendations',
    icon: '🎉',
    order: 999,
    estimatedDuration: 500,
    category: 'shared'
  },
  'error_handling': {
    label: 'Handling errors',
    icon: '⚠️',
    order: 1000,
    estimatedDuration: 1000,
    category: 'shared'
  }
};

// Progress tracker class
export class ProgressTracker {
  constructor(requestId, category = 'mood') {
    this.requestId = requestId;
    this.category = category; // 'mood', 'classic', or 'shared'
    this.startTime = Date.now();
    this.steps = [];
    this.currentStep = null;
    this.status = 'active';
    this.error = null;
    this.result = null;
    
    // Initialize progress in global store
    const initialData = {
      requestId,
      category,
      startTime: this.startTime,
      steps: [],
      currentStep: null,
      status: 'active',
      error: null,
      result: null,
      lastUpdated: Date.now()
    };
    
    progressStore.set(requestId, initialData);
    console.log(`ProgressTracker initialized for request: ${requestId} (category: ${category}) (store size: ${progressStore.size})`);
  }

  async updateStep(stepName, status, message = '', result = null) {
    const stepDef = STEP_DEFINITIONS[stepName];
    const timestamp = Date.now();
    
    // Get current progress data
    const progressData = progressStore.get(this.requestId);
    if (!progressData) {
      console.error(`Progress data not found for ${this.requestId}`);
      return;
    }

    // Find existing step or create new one
    let stepIndex = progressData.steps.findIndex(s => s.name === stepName);
    
    if (stepIndex === -1) {
      // Create new step
      const newStep = {
        name: stepName,
        label: stepDef?.label || stepName,
        icon: stepDef?.icon || '⚡',
        order: stepDef?.order || 999,
        category: stepDef?.category || 'shared',
        status: status,
        message: message,
        result: result,
        startTime: timestamp,
        duration: null,
        completed: false,
        lastUpdated: timestamp
      };
      
      progressData.steps.push(newStep);
      stepIndex = progressData.steps.length - 1;
    } else {
      // Update existing step
      progressData.steps[stepIndex] = {
        ...progressData.steps[stepIndex],
        status: status,
        message: message,
        result: result,
        lastUpdated: timestamp
      };
    }

    // Set current step if active
    if (status === 'active') {
      progressData.currentStep = stepName;
      this.currentStep = stepName;
    }

    // Update timestamp
    progressData.lastUpdated = timestamp;
    
    // Save back to store
    progressStore.set(this.requestId, progressData);
    
    console.log(`Progress updated for ${this.requestId}: ${stepName} - ${status} (store size: ${progressStore.size})`);
  }

  async completeStep(stepName, result = '', duration = null) {
    const progressData = progressStore.get(this.requestId);
    if (!progressData) {
      console.error(`Progress data not found for ${this.requestId}`);
      return;
    }

    const stepIndex = progressData.steps.findIndex(s => s.name === stepName);
    const timestamp = Date.now();
    
    if (stepIndex !== -1) {
      const step = progressData.steps[stepIndex];
      const calculatedDuration = duration || (step.startTime ? timestamp - step.startTime : null);
      
      progressData.steps[stepIndex] = {
        ...step,
        status: 'completed',
        result: result,
        duration: calculatedDuration,
        completed: true,
        endTime: timestamp,
        lastUpdated: timestamp
      };

      // Clear current step if this was the active one
      if (progressData.currentStep === stepName) {
        progressData.currentStep = null;
        this.currentStep = null;
      }

      // Update timestamp
      progressData.lastUpdated = timestamp;
      
      // Save back to store
      progressStore.set(this.requestId, progressData);

      console.log(`Step completed: ${stepName} - ${result} (${calculatedDuration}ms)`);
    }
  }

  async setError(stepName, errorMessage) {
    const progressData = progressStore.get(this.requestId);
    if (!progressData) {
      console.error(`Progress data not found for ${this.requestId}`);
      return;
    }

    const timestamp = Date.now();
    
    // Update the specific step with error
    if (stepName) {
      await this.updateStep(stepName, 'error', errorMessage);
    }

    // Set overall status to error
    progressData.status = 'error';
    progressData.error = errorMessage;
    progressData.currentStep = null;
    progressData.lastUpdated = timestamp;
    
    this.status = 'error';
    this.error = errorMessage;
    this.currentStep = null;

    // Save back to store
    progressStore.set(this.requestId, progressData);

    console.error(`Progress error for ${this.requestId}: ${errorMessage}`);
  }

  async complete(result = null) {
    const progressData = progressStore.get(this.requestId);
    if (!progressData) {
      console.error(`Progress data not found for ${this.requestId}`);
      return;
    }

    const timestamp = Date.now();
    const totalDuration = timestamp - progressData.startTime;
    
    progressData.status = 'completed';
    progressData.result = result;
    progressData.currentStep = null;
    progressData.totalDuration = totalDuration;
    progressData.endTime = timestamp;
    progressData.lastUpdated = timestamp;

    this.status = 'completed';
    this.result = result;
    this.currentStep = null;

    // Save back to store
    progressStore.set(this.requestId, progressData);

    console.log(`Progress completed for ${this.requestId} in ${totalDuration}ms (category: ${progressData.category})`);

    // Clean up old progress data after 5 minutes
    setTimeout(() => {
      if (progressStore.has(this.requestId)) {
        progressStore.delete(this.requestId);
        console.log(`Cleaned up progress data for ${this.requestId}`);
      }
    }, 5 * 60 * 1000);
  }

  getProgress() {
    return progressStore.get(this.requestId) || null;
  }

  // Helper method to get steps for specific category
  getStepsByCategory(category = null) {
    const progressData = progressStore.get(this.requestId);
    if (!progressData) return [];

    if (!category) return progressData.steps;
    
    return progressData.steps.filter(step => {
      const stepDef = STEP_DEFINITIONS[step.name];
      return stepDef?.category === category;
    });
  }

  // Helper method to get estimated total duration for category
  getEstimatedDuration(category = null) {
    const relevantSteps = Object.entries(STEP_DEFINITIONS).filter(([name, def]) => {
      return !category || def.category === category;
    });

    return relevantSteps.reduce((total, [name, def]) => {
      return total + (def.estimatedDuration || 2000);
    }, 0);
  }
}

// Store management functions
export const getProgressData = (requestId) => {
  const data = progressStore.get(requestId);
  console.log(`Getting progress for ${requestId}: ${data ? 'found' : 'not found'} (store size: ${progressStore.size})`);
  return data;
};

export const setProgressData = (requestId, data) => {
  progressStore.set(requestId, data);
  console.log(`Set progress for ${requestId} (store size: ${progressStore.size})`);
};

export const deleteProgressData = (requestId) => {
  const existed = progressStore.has(requestId);
  progressStore.delete(requestId);
  console.log(`Deleted progress for ${requestId}: ${existed ? 'existed' : 'not found'} (store size: ${progressStore.size})`);
  return existed;
};

export const getAllActiveProgress = () => {
  const activeProgress = [];
  for (const [requestId, data] of progressStore.entries()) {
    if (data.status === 'active') {
      activeProgress.push({
        requestId,
        category: data.category || 'unknown',
        startTime: data.startTime,
        currentStep: data.currentStep,
        stepCount: data.steps.length
      });
    }
  }
  return activeProgress;
};

export const getStoreSize = () => progressStore.size;

// Helper function to get steps by category
export const getStepDefinitionsByCategory = (category) => {
  return Object.entries(STEP_DEFINITIONS)
    .filter(([name, def]) => def.category === category)
    .reduce((acc, [name, def]) => {
      acc[name] = def;
      return acc;
    }, {});
};

// Helper function to get all categories
export const getAllCategories = () => {
  const categories = new Set();
  Object.values(STEP_DEFINITIONS).forEach(def => {
    if (def.category) categories.add(def.category);
  });
  return Array.from(categories);
};

// Clean up old progress data periodically
if (!global.progressCleanupInterval) {
  global.progressCleanupInterval = setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    for (const [requestId, data] of progressStore.entries()) {
      if (now - data.lastUpdated > maxAge) {
        progressStore.delete(requestId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} stale progress entries (store size: ${progressStore.size})`);
    }
  }, 5 * 60 * 1000); // Run cleanup every 5 minutes
  
  console.log('Progress cleanup interval initialized');
}