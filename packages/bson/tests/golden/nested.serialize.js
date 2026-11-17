// externals: String_0, isArray_0, stringifyValueWithType_0, validationErrorCreate_0, bound_has_0, validationErrorCreate_1, validationErrorCreate_2, validationErrorCreate_3
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=undefined;
if(isArray_0(v0.tags)){
    v3=v0.tags.map(function(v4,v5){    var v6=v4.label;
    if(v2.loosely!==false&&("number"===typeof v4.label||"boolean"===typeof v4.label||"bigint"===typeof v4.label)){
        v6=String_0(v4.label);
    }
return {id:v4.id,label:v6};
});
}
var v7={};
for(var v8 in v0.meta){
    if(!(bound_has_0(v8))){
        if(v0.meta[v8]!==undefined){
            var v9=undefined;
            var v10=false;
            if(!(v10)){
                if("number"===typeof v0.meta[v8]){
                    v9=v0.meta[v8];
                    v10=true;
                }
            }
            if(!(v10)){
                if("string"===typeof v0.meta[v8]){
                    var v11=v0.meta[v8];
                    if(v2.loosely!==false&&("number"===typeof v0.meta[v8]||"boolean"===typeof v0.meta[v8]||"bigint"===typeof v0.meta[v8])){
                        v11=String_0(v0.meta[v8]);
                    }
                    v9=v11;
                    v10=true;
                }
            }
            if(false){
                if(!(v10)){
                    if(("string"===typeof v0.meta[v8]||"number"===typeof v0.meta[v8]||"boolean"===typeof v0.meta[v8]||"bigint"===typeof v0.meta[v8])){
                        var v12=v0.meta[v8];
                        if(v2.loosely!==false&&("number"===typeof v0.meta[v8]||"boolean"===typeof v0.meta[v8]||"bigint"===typeof v0.meta[v8])){
                            v12=String_0(v0.meta[v8]);
                        }
                        v9=v12;
                        v10=true;
                    }
                }
            }
            if(!(v10)){
                var v13=[];
                v13.push({code:"type",path:("meta"+"."+String_0(v8)),message:("Cannot convert "+stringifyValueWithType_0(v0.meta[v8])+" to "+"string | number"+". No union member matches")});
                throw validationErrorCreate_0(v13);
            }
            v7[v8]=v9;
        }
    }
}
var v14=undefined;
var v15=false;
if(!(v15)){
    if(v0.state==="draft"){
        v14="draft";
        v15=true;
    }
}
if(!(v15)){
    if(v0.state==="live"){
        v14="live";
        v15=true;
    }
}
if(!(v15)){
    if(v0.state==="gone"){
        v14="gone";
        v15=true;
    }
}
if(false){
    if(!(v15)){
        if((v0.state==="draft"||String_0(v0.state)==="draft")){
            v14="draft";
            v15=true;
        }
    }
    if(!(v15)){
        if((v0.state==="live"||String_0(v0.state)==="live")){
            v14="live";
            v15=true;
        }
    }
    if(!(v15)){
        if((v0.state==="gone"||String_0(v0.state)==="gone")){
            v14="gone";
            v15=true;
        }
    }
}
if(!(v15)){
    var v16=[];
    v16.push({code:"type",path:"state",message:("Cannot convert "+stringifyValueWithType_0(v0.state)+" to "+"'draft' | 'live' | 'gone'"+". No union member matches")});
    throw validationErrorCreate_1(v16);
}
var v17=undefined;
var v18=false;
if((v0.shape==null||!("object"===typeof v0.shape))){
    var v19=[];
    v19.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"Shape"+". Not an object")});
    throw validationErrorCreate_2(v19);
}
switch(v0.shape.kind){
    case "circle":{
        v17={kind:"circle",r:v0.shape.r};
        v18=true;
    break;}
    case "rect":{
        v17={kind:"rect",w:v0.shape.w,h:v0.shape.h};
        v18=true;
    break;}
    default:{
        var v20=[];
        v20.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"Shape"+". Unknown discriminator value for 'kind'")});
        throw validationErrorCreate_3(v20);
    break;}
}
return {id:v0.id,tags:v3,meta:v7,state:v14,shape:v17,owner:{id:v0.owner.id,names:v0.owner.names}};
}
