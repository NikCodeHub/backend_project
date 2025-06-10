// cloud-cost-dashboard-frontend/backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Using GoogleGenerativeAI for Gemini

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Enable CORS for cross-origin requests from your frontend
app.use(express.json({ limit: '10mb' })); // For parsing application/json bodies, increased limit for potential larger contexts

// Gemini API Key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Ensure API key is set
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in the .env file!");
  console.error("Please create a .env file in the backend directory with GEMINI_API_KEY='YOUR_API_KEY_HERE'");
  process.exit(1); // Exit if API key is missing
}

// Initialize Gemini Generative AI model
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const textOnlyModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using gemini-2.0-flash as specified

// Helper function to format CSV summary for Gemini insights
function formatSummaryForGemini(summary) {
  let prompt = "Analyze the following AWS billing data summary. Provide a **brief, actionable summary** of key cost optimization insights. Focus on **top 3-5 recommendations** only. Use bullet points for recommendations. Keep the overall response **under 200 words**.\n\n";

  prompt += `Overall Billing Period: ${summary.totalOverallCost ? 'Data available' : 'No data'}\n`;
  if (summary.totalOverallCost) {
    prompt += `Total Unblended Cost: $${summary.totalOverallCost}\n\n`;
  }

  if (summary.serviceCosts && summary.serviceCosts.length > 0) {
    prompt += "Top 5 Services by Cost:\n";
    summary.serviceCosts.forEach(([service, cost]) => {
      prompt += `- ${service}: $${cost.toFixed(2)}\n`;
    });
    prompt += "\n";
  }

  if (summary.topExpensiveResources && summary.topExpensiveResources.length > 0) {
    prompt += "Top 5 Expensive Individual Resources:\n";
    summary.topExpensiveResources.forEach(res => {
      prompt += `- Resource ID: ${res.resourceId || 'N/A'}, Service: ${res.service}, Cost: $${res.totalCost.toFixed(2)}, Usage Types: ${res.usageTypes}, Occurrences: ${res.occurrences}, Duration: ${res.durationDays} days\n`;
    });
    prompt += "\n";
  }

  if (summary.idleResources && summary.idleResources.length > 0) {
    prompt += "Potential Idle/Underutilized Resources (Low Cost/Usage):\n";
    summary.idleResources.forEach(res => {
      prompt += `- Resource ID: ${res.resourceId || 'N/A'}, Service: ${res.service}, Cost: $${res.totalCost.toFixed(2)}, Occurrences: ${res.occurrences}, Duration: ${res.durationDays} days\n`;
    });
    prompt += "\n";
  }

  if (summary.dataTruncated) {
    prompt += "Note: The provided data was a sample (first 50,000 rows) due to large file size. Comprehensive analysis might require full dataset processing.\n\n";
  }

  prompt += "Based on this summary, provide the most impactful cost-saving actions, keeping the response concise and under 200 words. Start directly with the summary/recommendations.\n";

  return prompt;
}

// --- API Routes ---

// Default route to check if backend is running
app.get('/', (req, res) => {
  res.send('Cloud Cost Dashboard Backend is running!');
});

// Endpoint for general AI insights based on CSV summary
app.post('/api/ai/insights', async (req, res) => {
  const { csvSummary } = req.body;

  if (!csvSummary || Object.keys(csvSummary).length === 0) {
    return res.status(400).json({ error: 'No CSV summary provided for insights.' });
  }

  const prompt = formatSummaryForGemini(csvSummary);
  console.log("Sending prompt to Gemini (first 500 chars):", prompt.substring(0, 500) + "...");
  console.log("Full prompt length:", prompt.length);

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 200, // Limit output tokens for concise insights
      },
    });
    const response = result.response;
    const text = response.text();

    res.json({
      insights: text,
      // Also return the summary data, as it might be used on the frontend
      totalOverallCost: csvSummary.totalOverallCost,
      serviceCosts: csvSummary.serviceCosts,
      topExpensiveResources: csvSummary.topExpensiveResources,
      idleResources: csvSummary.idleResources,
      dataTruncated: csvSummary.dataTruncated
    });

  } catch (error) {
    console.error('Error calling Gemini API for insights:', error.message);
    // Log more details if available from the Gemini API response
    if (error.response && error.response.candidates) {
        console.error("Gemini API Error details:", JSON.stringify(error.response.candidates, null, 2));
    }
    res.status(500).json({ error: 'Failed to get AI insights from Gemini. Check backend logs for details.', details: error.message });
  }
});

// Endpoint for AI cost estimation
app.post('/api/ai/estimate', async (req, res) => {
  const { resourceType, size, region, duration } = req.body;

  if (!resourceType || !size || !region || !duration) {
    return res.status(400).json({ error: 'Missing required fields for estimation.' });
  }

  const prompt = `You are an AWS solutions architect and cost estimator.
  A user wants to understand the estimated monthly cost for an AWS service or architecture based on the following description:
  "Estimate the monthly cost for an AWS ${resourceType} of size ${size} in the ${region} region, running for approximately ${duration} hours/month."

  Provide a high-level monthly cost estimate in USD. Break down the estimate by key AWS components (e.g., EC2, S3, RDS, Data Transfer). If possible, suggest the most common or default options for each component.
  State any assumptions made.
  If the request is too vague, ask for more details.
  Format the output as a clear estimate, starting with "Estimated Monthly Cost: $XXX.XX".
  `;

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 150, // Limit output tokens for concise estimate
      },
    });
    const response = result.response;
    const text = response.text();
    res.json({ estimate: text });
  } catch (error) {
    console.error('Error estimating cost with Gemini:', error.message);
    res.status(500).json({ error: 'Failed to get cost estimate from Gemini.', details: error.message });
  }
});

// Endpoint for AI chat interactions
app.post('/api/ai/chat', async (req, res) => {
  const { userQuestion, csvContext } = req.body;

  if (!userQuestion) {
    return res.status(400).json({ error: 'No user question provided.' });
  }
  if (!csvContext) {
    return res.status(400).json({ error: 'No CSV context provided for the chat.' });
  }

  // Construct a detailed prompt for the AI, including the summarized CSV context
  const chatPrompt = `You are an expert AWS cost optimization assistant.
  A user has uploaded their AWS billing data. Here is a summary of their data:
  Total Overall Cost: ${csvContext.totalOverallCost || 'N/A'}
  Top Services by Cost: ${csvContext.topServices || 'N/A'}
  (Note: This context is based on ${csvContext.numRowsProcessed} rows. ${csvContext.dataTruncated ? 'The original CSV was larger, so this is a partial view.' : ''})

  The user is asking the following question about their AWS costs:
  "${userQuestion}"

  Based on the provided billing data summary and your AWS cost optimization knowledge, answer the user's question concisely and directly. If you need more information from the full CSV, state what information you would need. Keep your answer focused on cost optimization and provide actionable advice where relevant.
  `;

  console.log("Sending chat prompt to Gemini (first 500 chars):", chatPrompt.substring(0, 500) + "...");
  console.log("Full chat prompt length:", chatPrompt.length);

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: chatPrompt }] }],
      generationConfig: {
        maxOutputTokens: 250, // Limit chat response length
      },
    });
    const response = result.response;
    const text = response.text();
    res.json({ answer: text }); // Send the AI's answer back
  } catch (error) {
    console.error('Error calling Gemini API for chat:', error.message);
    if (error.response && error.response.candidates) {
        console.error("Gemini API Error details:", JSON.stringify(error.response.candidates, null, 2));
    }
    res.status(500).json({ error: 'Failed to get AI chat response.', details: error.message });
  }
});

// NEW: AI Recommendation for Cost Savings Panel
// This endpoint receives context about a specific optimization opportunity
// and uses AI to generate actionable recommendations.
app.post('/api/ai/recommendation', async (req, res) => {
    const { promptContext } = req.body; // promptContext will describe the specific saving opportunity

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for recommendation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                // CRUCIAL: Combine the strict instruction directly in the user message,
                // and pass the detailed context as a second part.
                parts: [
                    { text: `Provide a **single, extremely concise sentence or a maximum of two very short bullet points** with the most important actionable recommendation for this cloud cost optimization opportunity. Focus only on the primary step to take.` },
                    { text: `Opportunity Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 50, // Even further reduced
                temperature: 0.2, // Lower temperature for less creativity, more directness
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ recommendation: text }); // Send the AI's recommendation back to the frontend
    } catch (error) {
        console.error('Error generating AI recommendation:', error);
        // Provide more detailed error info for frontend debugging
        res.status(500).json({
            error: 'Failed to generate AI recommendation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});


// Start the server
app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
