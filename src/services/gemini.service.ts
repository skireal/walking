
import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';

export interface RouteSuggestion {
  routeName: string;
  description: string;
  duration: string;
  distance: string;
  pointsOfInterest: string[];
  directions: string[];
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private genAI: GoogleGenAI | null = null;
  
  constructor() {
    // IMPORTANT: In a real app, the API key would be handled securely and not exposed.
    // The Applet environment provides this via `process.env.API_KEY`.
    if (process.env.API_KEY) {
      this.genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      console.error('API_KEY environment variable not found.');
    }
  }

  async getRouteSuggestion(location: string, duration: number): Promise<RouteSuggestion> {
    if (!this.genAI) {
      throw new Error('Gemini AI client is not initialized. Check API Key.');
    }

    const model = 'gemini-2.5-flash';
    const prompt = `Suggest a scenic walking route starting near ${location} that takes about ${duration} minutes for an average walker. Describe the route, mention a few points of interest, and provide simple turn-by-turn directions.`;

    const schema = {
        type: Type.OBJECT,
        properties: {
            routeName: { type: Type.STRING, description: 'A creative and descriptive name for the walking route.' },
            description: { type: Type.STRING, description: 'A brief, engaging summary of the walk.' },
            duration: { type: Type.STRING, description: 'Estimated duration of the walk in minutes, as a string (e.g., "30 minutes").' },
            distance: { type: Type.STRING, description: 'Estimated distance of the walk, as a string (e.g., "2.5 km").' },
            pointsOfInterest: { 
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'An array of 2-3 key points of interest along the route.'
            },
            directions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'A list of simple, turn-by-turn directions.'
            }
        },
        required: ['routeName', 'description', 'duration', 'distance', 'pointsOfInterest', 'directions']
    };

    try {
        const response = await this.genAI.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0.7,
            },
        });

        const jsonString = response.text.trim();
        return JSON.parse(jsonString) as RouteSuggestion;
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        throw new Error('Failed to get route suggestion from AI.');
    }
  }
}
