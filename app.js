// cloud-cost-dashboard-frontend/backend/index.js
// --- VERIFICATION TAG: v20250611_SECURITY_COMPLIANCE_FINAL_FIX ---
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

// DIAGNOSTIC ROUTE (keep this here for testing)
app.get('/test-backend', (req, res) => {
    res.json({ message: 'Backend is reachable and test route works! Tag: v20250611_SECURITY_COMPLIANCE_FINAL_FIX' });
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

// Endpoint for AI chat interactions (ENHANCED for general cloud questions)
app.post('/api/ai/chat', async (req, res) => {
  const { userQuestion, csvContext } = req.body; // csvContext can now be optional or minimal

  if (!userQuestion) {
    return res.status(400).json({ error: 'No user question provided.' });
  }

  let chatPrompt = `You are an expert AWS Cloud Operations and FinOps Assistant. Your goal is to help users understand, manage, and operate their AWS resources efficiently. Provide clear, concise, and accurate answers based on your extensive knowledge of AWS services, best practices (cost, security, operations), and common cloud concepts.`;

  // Conditionally add context if CSV data is available and potentially relevant
  if (csvContext && csvContext.hasData) {
    chatPrompt += `\n\nUser has uploaded AWS billing data. While your primary role is general cloud assistance, if the question seems related to their costs, you can infer context. Here's a brief indicator: Data exists for ${csvContext.numRowsProcessed} line items.`;
    // If you want to send more detailed summary, you'd generate it here from parsedCsvData if available
    // For now, let's keep it minimal for general chat.
  }

  chatPrompt += `\n\nUser's question: "${userQuestion}"`;

  console.log("Sending general cloud chat prompt to Gemini (first 500 chars):", chatPrompt.substring(0, 500) + "...");
  console.log("Full chat prompt length:", chatPrompt.length);

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: chatPrompt }] }],
      generationConfig: {
        maxOutputTokens: 300, // Increased tokens for more comprehensive general answers
        temperature: 0.5, // Balanced for informative and coherent responses
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

// AI Recommendation for Cost Savings Panel
app.post('/api/ai/recommendation', async (req, res) => {
    const { promptContext } = req.body; // promptContext will describe the specific saving opportunity

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for recommendation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `Provide a **single, extremely concise sentence or a maximum of two very short bullet points** with the most important actionable recommendation for this cloud cost optimization opportunity. Focus only on the primary step to take.` },
                    { text: `Opportunity Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 50, // Even further reduced for conciseness
                temperature: 0.2, // Lower temperature for less creativity, more directness
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ recommendation: text }); // Send the AI's recommendation back to the frontend
    } catch (error) {
        console.error('Error generating AI recommendation:', error);
        res.status(500).json({
            error: 'Failed to generate AI recommendation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Anomaly Explanation Endpoint
app.post('/api/ai/explain-anomaly', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for anomaly explanation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an AWS cost forensic analyst, provide a **concise (1-3 sentences) explanation** for the likely root cause of the following cloud cost anomaly and suggest **one immediate investigation step**. Focus on the most probable reason based on the provided details.` },
                    { text: `Anomaly Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 100, // Concise explanation
                temperature: 0.4, // A bit more creative than recommendations, but still focused
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ explanation: text });
    } catch (error) {
        console.error('Error generating AI anomaly explanation:', error);
        res.status(500).json({
            error: 'Failed to generate AI anomaly explanation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Resource Optimization Endpoint
app.post('/api/ai/resource-optimization', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for resource optimization is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS resource optimization specialist, provide a **detailed, actionable plan (3-5 bullet points)** for the following cloud resource optimization opportunity. Focus on concrete steps a user can take.` },
                    { text: `Opportunity Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 200,
                temperature: 0.3,
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ optimizationPlan: text });
    } catch (error) {
        console.error('Error generating AI resource optimization plan:', error);
        res.status(500).json({
            error: 'Failed to generate AI resource optimization plan.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Troubleshooting Endpoint
app.post('/api/ai/troubleshoot', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for troubleshooting is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As a Senior Cloud Support Engineer for AWS, analyze the following operational problem and provide:
                    1.  **Likely Causes:** 1-3 potential reasons for this problem.
                    2.  **Diagnostic Steps:** 2-3 immediate, actionable steps the user can take to investigate.
                    3.  **Common Solutions:** 1-2 common solutions if the problem is identified.
                    Format your response clearly with bolded headings for each section. Keep the overall response concise and directly focused on the problem.` },
                    { text: `User's Problem: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 250, // Allow a bit more for structured troubleshooting steps
                temperature: 0.4, // Balanced for informative and accurate troubleshooting
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ troubleshootResponse: text });
    } catch (error) {
        console.error('Error generating AI troubleshooting response:', error);
        res.status(500).json({
            error: 'Failed to generate AI troubleshooting response.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Architecture Assistant Endpoint
app.post('/api/ai/architecture-assistant', async (req, res) => {
    const { promptContext } = req.body; // user's architectural problem/goal

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for architecture assistant is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Solutions Architect, provide guidance for the following cloud solution request. Your response should include:
                    1.  **Recommended AWS Services:** List 3-5 key services and briefly explain their role.
                    2.  **Conceptual Architecture:** Describe how these services would conceptually integrate at a high level.
                    3.  **Key Considerations:** Mention important aspects like scalability, security, main cost drivers, and reliability for this architecture.
                    Format your response clearly with bolded headings for each section. Keep the overall response comprehensive but concise.` },
                    { text: `User's Request: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 400, // Increased tokens for more detailed architectural guidance
                temperature: 0.7, // Slightly higher for more creative/diverse architectural suggestions
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ architectureGuidance: text });
    } catch (error) {
        console.error('Error generating AI architectural guidance:', error);
        res.status(500).json({
            error: 'Failed to generate AI architectural guidance.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Security and Compliance Endpoint
// This endpoint receives a user's query about AWS security or compliance
// and uses AI to provide expert advice and best practices.
app.post('/api/ai/security-compliance', async (req, res) => {
    const { promptContext } = req.body; // user's security/compliance query

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for security and compliance is required.' });
    }

    try {
        console.log('Received request for /api/ai/security-compliance'); // Diagnostic log
        console.log('Sending prompt to Gemini for security/compliance:', promptContext.substring(0, 200) + '...'); // Diagnostic log

        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Security and Compliance Advisor, provide a concise and accurate answer to the following user query.
                    If the query is about best practices, list key actionable steps (1-3 bullet points).
                    If the query is about a compliance standard, briefly explain its relevance to AWS and key considerations.
                    Focus on practical, actionable advice. Provide your answer directly.` },
                    { text: `User's Query: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 200, // Balanced for concise but informative answers
                temperature: 0.3, // Lower temperature for more factual and direct responses
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        console.log('Gemini security/compliance response received:', text.substring(0, 100) + '...'); // Diagnostic log
        res.json({ securityComplianceResponse: text }); // Send the AI's response back
    } catch (error) {
        console.error('Error generating AI security/compliance response:', error);
        res.status(500).json({
            error: 'Failed to generate AI security/compliance response.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});


// Start the server
app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
