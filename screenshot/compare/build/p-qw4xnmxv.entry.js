import{r as t,h as e}from"./p-b6e44a24.js";const n=class{constructor(e){t(this,e),this.content=""}componentWillLoad(){if(null!=this.documentLocation)return this.fetchNewContent(this.documentLocation)}fetchNewContent(t){return fetch(t).then(t=>t.text()).then(t=>{this.content=t})}render(){return e("div",{innerHTML:this.content})}static get watchers(){return{documentLocation:["fetchNewContent"]}}};export{n as rindo_async_content};