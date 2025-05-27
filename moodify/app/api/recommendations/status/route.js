import { NextResponse } from 'next/server';
import { 
  ProgressTracker, 
  STEP_DEFINITIONS, 
  getProgressData, 
  setProgressData, 
  deleteProgressData, 
  getAllActiveProgress,
  getStoreSize,
  getStepDefinitionsByCategory,
  getAllCategories
} from '../../../lib/progressStore';

// GET endpoint to fetch progress status
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const category = searchParams.get('category'); // Optional filter by category
    const includeStepsByCategory = searchParams.get('includeStepsByCategory') === 'true';

    if (!requestId) {
      return NextResponse.json({
        error: 'Missing requestId parameter'
      }, { status: 400 });
    }

    console.log(`GET request for progress: ${requestId} (category: ${category || 'all'}) (store size: ${getStoreSize()})`);
    const progressData = getProgressData(requestId);

    if (!progressData) {
      console.log(`Progress data not found for: ${requestId}`);
      return NextResponse.json({
        error: 'Progress data not found',
        requestId: requestId,
        storeSize: getStoreSize(),
        availableRequests: getAllActiveProgress().map(p => ({
          requestId: p.requestId,
          category: p.category || 'unknown',
          currentStep: p.currentStep,
          stepCount: p.stepCount
        }))
      }, { status: 404 });
    }

    // Filter steps by category if specified
    let relevantSteps = progressData.steps;
    if (category && category !== 'all') {
      relevantSteps = progressData.steps.filter(step => {
        const stepDef = STEP_DEFINITIONS[step.name];
        return stepDef?.category === category || stepDef?.category === 'shared';
      });
    }

    // Sort steps by order for consistent display
    const sortedSteps = [...relevantSteps].sort((a, b) => {
      const aOrder = STEP_DEFINITIONS[a.name]?.order || 999;
      const bOrder = STEP_DEFINITIONS[b.name]?.order || 999;
      return aOrder - bOrder;
    });

    // Calculate progress percentage
    const totalSteps = sortedSteps.length;
    const completedSteps = sortedSteps.filter(s => s.completed).length;
    const progressPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Estimate time remaining
    let estimatedTimeRemaining = null;
    if (progressData.status === 'active' && progressData.currentStep) {
      const currentStepDef = STEP_DEFINITIONS[progressData.currentStep];
      const remainingSteps = sortedSteps.filter(s => !s.completed && s.name !== progressData.currentStep);
      
      const currentStepEstimate = currentStepDef?.estimatedDuration || 2000;
      const remainingStepsEstimate = remainingSteps.reduce((total, step) => {
        const stepDef = STEP_DEFINITIONS[step.name];
        return total + (stepDef?.estimatedDuration || 2000);
      }, 0);
      
      estimatedTimeRemaining = currentStepEstimate + remainingStepsEstimate;
    }

    // Group steps by category for better organization (if requested)
    let stepsByCategory = null;
    if (includeStepsByCategory) {
      stepsByCategory = {};
      sortedSteps.forEach(step => {
        const stepDef = STEP_DEFINITIONS[step.name];
        const stepCategory = stepDef?.category || 'unknown';
        
        if (!stepsByCategory[stepCategory]) {
          stepsByCategory[stepCategory] = [];
        }
        stepsByCategory[stepCategory].push(step);
      });
    }

    // Get current step details
    const currentStepDetails = progressData.currentStep ? {
      name: progressData.currentStep,
      definition: STEP_DEFINITIONS[progressData.currentStep] || {},
      step: sortedSteps.find(s => s.name === progressData.currentStep) || null
    } : null;

    // Calculate category-specific progress if we have category data
    const categoryProgress = {};
    if (progressData.category || category) {
      const targetCategory = category || progressData.category;
      const categorySteps = progressData.steps.filter(step => {
        const stepDef = STEP_DEFINITIONS[step.name];
        return stepDef?.category === targetCategory || stepDef?.category === 'shared';
      });
      
      const categoryCompleted = categorySteps.filter(s => s.completed).length;
      const categoryTotal = categorySteps.length;
      
      categoryProgress[targetCategory] = {
        completed: categoryCompleted,
        total: categoryTotal,
        percentage: categoryTotal > 0 ? Math.round((categoryCompleted / categoryTotal) * 100) : 0
      };
    }

    const response = {
      requestId: progressData.requestId,
      category: progressData.category || 'unknown',
      status: progressData.status,
      currentStep: progressData.currentStep,
      currentStepDetails: currentStepDetails,
      
      // Step information
      steps: sortedSteps,
      ...(stepsByCategory && { stepsByCategory }),
      
      // Progress calculations
      progress: {
        percentage: progressPercentage,
        completedSteps: completedSteps,
        totalSteps: totalSteps,
        estimatedTimeRemaining: estimatedTimeRemaining
      },
      
      // Category-specific progress
      categoryProgress: categoryProgress,
      
      // Available categories and metadata
      availableCategories: getAllCategories(),
      categoryDefinitions: Object.fromEntries(
        getAllCategories().map(cat => [
          cat, 
          {
            steps: getStepDefinitionsByCategory(cat),
            totalEstimatedDuration: Object.values(getStepDefinitionsByCategory(cat))
              .reduce((sum, def) => sum + (def.estimatedDuration || 2000), 0)
          }
        ])
      ),
      
      // Timing information
      timing: {
        startTime: progressData.startTime,
        lastUpdated: progressData.lastUpdated,
        totalDuration: progressData.totalDuration || (Date.now() - progressData.startTime),
        endTime: progressData.endTime || null
      },
      
      // Error and result
      error: progressData.error,
      result: progressData.result
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching progress status:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// POST endpoint to manually update progress (for testing or external updates)
export async function POST(request) {
  try {
    const body = await request.json();
    const { requestId, stepName, status, message, result, action, category } = body;

    if (!requestId) {
      return NextResponse.json({
        error: 'Missing requestId'
      }, { status: 400 });
    }

    console.log(`POST request for progress: ${requestId}, action: ${action}, category: ${category || 'default'}`);

    // Handle different actions
    switch (action) {
      case 'create':
        // Create new progress tracker with optional category
        const tracker = new ProgressTracker(requestId, category || 'mood');
        return NextResponse.json({
          message: 'Progress tracker created',
          requestId: requestId,
          category: category || 'mood',
          availableCategories: getAllCategories()
        });

      case 'update':
        if (!stepName || !status) {
          return NextResponse.json({
            error: 'Missing stepName or status for update'
          }, { status: 400 });
        }

        const progressData = getProgressData(requestId);
        if (!progressData) {
          return NextResponse.json({
            error: 'Progress data not found'
          }, { status: 404 });
        }

        // Create a temporary tracker to use the update methods
        const tempTracker = new ProgressTracker(requestId, progressData.category);
        
        if (status === 'completed') {
          await tempTracker.completeStep(stepName, result);
        } else {
          await tempTracker.updateStep(stepName, status, message, result);
        }

        return NextResponse.json({
          message: 'Step updated successfully',
          requestId: requestId,
          step: stepName,
          status: status,
          category: progressData.category
        });

      case 'complete':
        const completeData = getProgressData(requestId);
        if (completeData) {
          const completeTracker = new ProgressTracker(requestId, completeData.category);
          await completeTracker.complete(result);
        }

        return NextResponse.json({
          message: 'Progress completed',
          requestId: requestId,
          category: completeData?.category,
          result: result
        });

      case 'error':
        const errorData = getProgressData(requestId);
        if (errorData) {
          const errorTracker = new ProgressTracker(requestId, errorData.category);
          await errorTracker.setError(stepName, message);
        }

        return NextResponse.json({
          message: 'Error set',
          requestId: requestId,
          category: errorData?.category,
          error: message
        });

      case 'get_definitions':
        // Return step definitions for a specific category
        const requestedCategory = category || 'mood';
        const categorySteps = getStepDefinitionsByCategory(requestedCategory);
        
        return NextResponse.json({
          category: requestedCategory,
          steps: categorySteps,
          allCategories: getAllCategories(),
          totalEstimatedDuration: Object.values(categorySteps)
            .reduce((sum, def) => sum + (def.estimatedDuration || 2000), 0)
        });

      case 'get_all_active':
        // Return all active progress sessions
        const activeSessions = getAllActiveProgress();
        return NextResponse.json({
          activeSessions: activeSessions,
          totalActive: activeSessions.length,
          storeSize: getStoreSize()
        });

      case 'reset':
        // Reset a specific step
        if (!stepName) {
          return NextResponse.json({
            error: 'Missing stepName for reset'
          }, { status: 400 });
        }

        const resetData = getProgressData(requestId);
        if (resetData) {
          const resetTracker = new ProgressTracker(requestId, resetData.category);
          await resetTracker.updateStep(stepName, 'pending', 'Step reset', null);
        }

        return NextResponse.json({
          message: 'Step reset successfully',
          requestId: requestId,
          step: stepName,
          category: resetData?.category
        });

      default:
        return NextResponse.json({
          error: 'Invalid action. Available actions: create, update, complete, error, get_definitions, get_all_active, reset'
        }, { status: 400 });
    }

  } catch (error) {
    console.error('Error updating progress:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// DELETE endpoint to clean up progress data
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const cleanup = searchParams.get('cleanup'); // 'old' to clean up old entries

    if (cleanup === 'old') {
      // Clean up old progress entries
      const now = Date.now();
      const maxAge = 30 * 60 * 1000; // 30 minutes
      let cleanedCount = 0;
      
      const allProgress = getAllActiveProgress();
      for (const progress of allProgress) {
        const progressData = getProgressData(progress.requestId);
        if (progressData && (now - progressData.lastUpdated) > maxAge) {
          deleteProgressData(progress.requestId);
          cleanedCount++;
        }
      }

      return NextResponse.json({
        message: `Cleaned up ${cleanedCount} old progress entries`,
        cleanedCount: cleanedCount,
        remainingCount: getStoreSize()
      });
    }

    if (!requestId) {
      return NextResponse.json({
        error: 'Missing requestId parameter'
      }, { status: 400 });
    }

    const progressData = getProgressData(requestId);
    const existed = deleteProgressData(requestId);

    return NextResponse.json({
      message: existed ? 'Progress data deleted' : 'Progress data not found',
      requestId: requestId,
      existed: existed,
      category: progressData?.category || 'unknown',
      storeSize: getStoreSize()
    });

  } catch (error) {
    console.error('Error deleting progress data:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// Utility function to get all active progress sessions (for debugging)
export function getAllActiveProgressSessions() {
  return getAllActiveProgress().map(session => ({
    ...session,
    progressData: getProgressData(session.requestId)
  }));
}

// Health check endpoint
export async function HEAD(request) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'X-Store-Size': getStoreSize().toString(),
      'X-Active-Sessions': getAllActiveProgress().length.toString(),
      'X-Available-Categories': getAllCategories().join(',')
    }
  });
}