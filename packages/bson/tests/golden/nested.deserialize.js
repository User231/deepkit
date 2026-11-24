// externals: isSignedNumericString_0, String_0, Number_0, stringifyValueWithType_0, validationErrorCreate_0, isArray_0, fn_0, validationErrorCreate_1, ownProtoKey_0, validationErrorCreate_2, validationErrorCreate_3, validationErrorCreate_4, validationErrorCreate_5, validationErrorCreate_6, validationErrorCreate_7, validationErrorCreate_8, validationErrorCreate_9
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=undefined;
if("object"===typeof v0&&null!==v0){
    var v4=false;
    if(v2.loosely!==false&&"string"===typeof v0.id){
        v4=isSignedNumericString_0(v0.id);
    }
    var v5=undefined;
    if(isArray_0(v0.tags)){
        v5=v0.tags.map(function(v6,v7){        var v8=undefined;
        if("object"===typeof v6&&null!==v6){
            var v9=false;
            if(v2.loosely!==false&&"string"===typeof v6.id){
                v9=isSignedNumericString_0(v6.id);
            }
            var v10=v6.label;
            if(v2.loosely!==false&&("number"===typeof v6.label||"boolean"===typeof v6.label||"bigint"===typeof v6.label)){
                v10=String_0(v6.label);
            }
            v8={id:("number"===typeof v6.id?v6.id:(v2.loosely!==false&&"boolean"===typeof v6.id?(v6.id?1:0):(v9?Number_0(v6.id):v6.id))),label:v10};
        }else{
            var v11=[];
            v11.push({code:"type",path:("tags"+"."+String_0(v7)),message:("Cannot convert "+stringifyValueWithType_0(v6)+" to "+"Tag"+"")});
            throw validationErrorCreate_0(v11);
        }
return v8;
});
    }
    var v12=undefined;
    if("object"===typeof v0.meta&&null!==v0.meta){
        var v13={};
        for(var v14 in v0.meta){
            if(v0.meta[v14]!==undefined){
                var v15=undefined;
                var v16=false;
                if(!(v16)){
                    if((v2.loosely!==false?("number"===typeof v0.meta[v14]||"string"===typeof v0.meta[v14]&&fn_0(v0.meta[v14])):"number"===typeof v0.meta[v14])){
                        var v17=false;
                        if(v2.loosely!==false&&"string"===typeof v0.meta[v14]){
                            v17=isSignedNumericString_0(v0.meta[v14]);
                        }
                        v15=("number"===typeof v0.meta[v14]?v0.meta[v14]:(v2.loosely!==false&&"boolean"===typeof v0.meta[v14]?(v0.meta[v14]?1:0):(v17?Number_0(v0.meta[v14]):v0.meta[v14])));
                        v16=true;
                    }
                }
                if(!(v16)){
                    if("string"===typeof v0.meta[v14]){
                        var v18=v0.meta[v14];
                        if(v2.loosely!==false&&("number"===typeof v0.meta[v14]||"boolean"===typeof v0.meta[v14]||"bigint"===typeof v0.meta[v14])){
                            v18=String_0(v0.meta[v14]);
                        }
                        v15=v18;
                        v16=true;
                    }
                }
                if(v2.loosely!==false){
                    if(!(v16)){
                        if(("string"===typeof v0.meta[v14]||"number"===typeof v0.meta[v14]||"boolean"===typeof v0.meta[v14]||"bigint"===typeof v0.meta[v14])){
                            var v19=v0.meta[v14];
                            if(v2.loosely!==false&&("number"===typeof v0.meta[v14]||"boolean"===typeof v0.meta[v14]||"bigint"===typeof v0.meta[v14])){
                                v19=String_0(v0.meta[v14]);
                            }
                            v15=v19;
                            v16=true;
                        }
                    }
                }
                if(!(v16)){
                    var v20=[];
                    v20.push({code:"type",path:("meta"+"."+String_0(v14)),message:("Cannot convert "+stringifyValueWithType_0(v0.meta[v14])+" to "+"string | number"+". No union member matches")});
                    throw validationErrorCreate_1(v20);
                }
                if(v14==="__proto__"){
                    ownProtoKey_0(v13);
                }
                v13[v14]=v15;
            }
        }
        v12=v13;
    }else{
        var v21=[];
        v21.push({code:"type",path:"meta",message:("Cannot convert "+stringifyValueWithType_0(v0.meta)+" to "+"Record<string, string | number>"+"")});
        throw validationErrorCreate_2(v21);
    }
    var v22=undefined;
    var v23=false;
    if(!(v23)){
        if(v0.state==="draft"){
            v22="draft";
            v23=true;
        }
    }
    if(!(v23)){
        if(v0.state==="live"){
            v22="live";
            v23=true;
        }
    }
    if(!(v23)){
        if(v0.state==="gone"){
            v22="gone";
            v23=true;
        }
    }
    if(v2.loosely!==false){
        if(!(v23)){
            if((v0.state==="draft"||String_0(v0.state)==="draft")){
                v22="draft";
                v23=true;
            }
        }
        if(!(v23)){
            if((v0.state==="live"||String_0(v0.state)==="live")){
                v22="live";
                v23=true;
            }
        }
        if(!(v23)){
            if((v0.state==="gone"||String_0(v0.state)==="gone")){
                v22="gone";
                v23=true;
            }
        }
    }
    if(!(v23)){
        var v24=[];
        v24.push({code:"type",path:"state",message:("Cannot convert "+stringifyValueWithType_0(v0.state)+" to "+"'draft' | 'live' | 'gone'"+". No union member matches")});
        throw validationErrorCreate_3(v24);
    }
    var v25=undefined;
    var v26=false;
    if((v0.shape==null||!("object"===typeof v0.shape))){
        var v27=[];
        v27.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"Shape"+". Not an object")});
        throw validationErrorCreate_4(v27);
    }
    switch(v0.shape.kind){
        case "circle":{
            var v28=undefined;
            if("object"===typeof v0.shape&&null!==v0.shape){
                var v29=false;
                if(v2.loosely!==false&&"string"===typeof v0.shape.r){
                    v29=isSignedNumericString_0(v0.shape.r);
                }
                v28={kind:"circle",r:("number"===typeof v0.shape.r?v0.shape.r:(v2.loosely!==false&&"boolean"===typeof v0.shape.r?(v0.shape.r?1:0):(v29?Number_0(v0.shape.r):v0.shape.r)))};
            }else{
                var v30=[];
                v30.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"{ kind: 'circle'; r: number;}"+"")});
                throw validationErrorCreate_5(v30);
            }
            v25=v28;
            v26=true;
        break;}
        case "rect":{
            var v31=undefined;
            if("object"===typeof v0.shape&&null!==v0.shape){
                var v32=false;
                if(v2.loosely!==false&&"string"===typeof v0.shape.w){
                    v32=isSignedNumericString_0(v0.shape.w);
                }
                var v33=false;
                if(v2.loosely!==false&&"string"===typeof v0.shape.h){
                    v33=isSignedNumericString_0(v0.shape.h);
                }
                v31={kind:"rect",w:("number"===typeof v0.shape.w?v0.shape.w:(v2.loosely!==false&&"boolean"===typeof v0.shape.w?(v0.shape.w?1:0):(v32?Number_0(v0.shape.w):v0.shape.w))),h:("number"===typeof v0.shape.h?v0.shape.h:(v2.loosely!==false&&"boolean"===typeof v0.shape.h?(v0.shape.h?1:0):(v33?Number_0(v0.shape.h):v0.shape.h)))};
            }else{
                var v34=[];
                v34.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"{ kind: 'rect'; w: number; h: number;}"+"")});
                throw validationErrorCreate_6(v34);
            }
            v25=v31;
            v26=true;
        break;}
        default:{
            var v35=[];
            v35.push({code:"type",path:"shape",message:("Cannot convert "+stringifyValueWithType_0(v0.shape)+" to "+"Shape"+". Unknown discriminator value for 'kind'")});
            throw validationErrorCreate_7(v35);
        break;}
    }
    var v36=undefined;
    if("object"===typeof v0.owner&&null!==v0.owner){
        var v37=false;
        if(v2.loosely!==false&&"string"===typeof v0.owner.id){
            v37=isSignedNumericString_0(v0.owner.id);
        }
        var v38=undefined;
        if(isArray_0(v0.owner.names)){
            v38=v0.owner.names.map(function(v39,v40){            var v41=v39;
            if(v2.loosely!==false&&("number"===typeof v39||"boolean"===typeof v39||"bigint"===typeof v39)){
                v41=String_0(v39);
            }
return v41;
});
        }
        v36={id:("number"===typeof v0.owner.id?v0.owner.id:(v2.loosely!==false&&"boolean"===typeof v0.owner.id?(v0.owner.id?1:0):(v37?Number_0(v0.owner.id):v0.owner.id))),names:v38};
    }else{
        var v42=[];
        v42.push({code:"type",path:"owner",message:("Cannot convert "+stringifyValueWithType_0(v0.owner)+" to "+"{ id: number; names: Array<string>;}"+"")});
        throw validationErrorCreate_8(v42);
    }
    v3={id:("number"===typeof v0.id?v0.id:(v2.loosely!==false&&"boolean"===typeof v0.id?(v0.id?1:0):(v4?Number_0(v0.id):v0.id))),tags:v5,meta:v12,state:v22,shape:v25,owner:v36};
}else{
    var v43=[];
    v43.push({code:"type",path:"",message:("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"Nested"+"")});
    throw validationErrorCreate_9(v43);
}
return v3;
}
