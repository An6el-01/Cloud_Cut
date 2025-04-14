'use client';

import { useState } from 'react';
import { createUser } from '@/app/actions';

export default function ApiTestPage() {
  const [testResult, setTestResult] = useState<string>('');
  const [testResponse, setTestResponse] = useState<string>('');
  const [actionResult, setActionResult] = useState<string>('');
  
  const testApiGet = async () => {
    try {
      const response = await fetch('/api/test-api');
      const text = await response.text();
      setTestResult(`Status: ${response.status}, Response: ${text}`);
    } catch (error) {
      setTestResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  const testApiPost = async () => {
    try {
      const response = await fetch('/api/test-api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: 'data' })
      });
      const text = await response.text();
      setTestResponse(`Status: ${response.status}, Response: ${text}`);
    } catch (error) {
      setTestResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const testServerAction = async () => {
    try {
      const result = await createUser({
        email: 'test@example.com',
        name: 'Test User',
        phone: '1234567890',
        role: 'Operator',
        adminEmail: 'a.salinas@shadowfoam.com'
      });
      setActionResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setActionResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">API Testing Page</h1>
      
      <div className="mb-8 p-4 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Test GET API</h2>
        <button 
          onClick={testApiGet}
          className="px-4 py-2 bg-blue-500 text-white rounded mb-4"
        >
          Test GET
        </button>
        <div className="p-4 bg-gray-100 rounded">
          <pre>{testResult || 'No result yet'}</pre>
        </div>
      </div>

      <div className="mb-8 p-4 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Test POST API</h2>
        <button 
          onClick={testApiPost}
          className="px-4 py-2 bg-green-500 text-white rounded mb-4"
        >
          Test POST
        </button>
        <div className="p-4 bg-gray-100 rounded">
          <pre>{testResponse || 'No result yet'}</pre>
        </div>
      </div>

      <div className="p-4 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Test Server Action</h2>
        <button 
          onClick={testServerAction}
          className="px-4 py-2 bg-purple-500 text-white rounded mb-4"
        >
          Test Server Action
        </button>
        <div className="p-4 bg-gray-100 rounded">
          <pre>{actionResult || 'No result yet'}</pre>
        </div>
      </div>
    </div>
  );
} 