'use strict';

// tests for coa
// Generated by serverless-mocha-plugin

const mochaPlugin = require('serverless-mocha-plugin');
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('coa', '/lib/handler.js', 'changeObjectAuthorHandler');

describe('coa', () => {
  before((done) => {
    done();
  });

  it('Change to new author', async () => {
    const body = { 
      fromUserID: '5a9f0490a54db934142456d1',
      toUserID: '5ebc4a42f12eaa2c68853c49',
      objectID: '5aa84718ecba9a264dcd80a1',
  }

  const jsonString = JSON.stringify(body);

    wrapped.run({body: jsonString}).then(res=> { 
      expect(res).to.not.be.to.empty;
      expect(res.message).to.equal('success')
      expect(res.statusCode).to.equal(200)

    },
    error=> { 
      console.log(`Tests failed...`, error)
    });
    // expect(response).to.not.be.empty;
  });

  it('Reset learning object author', async ()=> { 
    const body = { 
      fromUserID: '5ebc4a42f12eaa2c68853c49',
      toUserID: '5a9f0490a54db934142456d1',
      objectID: '5aa84718ecba9a264dcd80a1'
    }

    const jsonString = JSON.stringify(body); 

    wrapped.run({body: jsonString}).then(res=> { 
      expect(res).to.not.be.to.empty;
      expect(res.message).to.equal('success')
      expect(res.statusCode).to.equal(200)
    }),
    error=> { 
      console.log('Tests failed ...', error)
    }
  })

  after((done)=>{
    done();
  })
});
